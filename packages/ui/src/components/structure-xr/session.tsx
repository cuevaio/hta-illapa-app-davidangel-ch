import { Text } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import {
	useGetXRSpaceMatrix,
	useXR,
	useXRAnchor,
	useXRHitTest,
	useXRStore,
	XRSpace,
} from "@react-three/xr";
import { Suspense, useEffect, useRef, useState } from "react";
import { type Group, Matrix4, Quaternion, Vector3 } from "three";
import { useTokenColors } from "../../hooks/use-token-colors";
import { STRUCTURE_COLOR_TOKENS } from "../../lib/structure-colors";
import type { StructureXrSessionProps } from "../structure-xr";
import {
	HINT_DISTANCE_M,
	HINT_FONT_SIZE_M,
	HINT_HEIGHT_M,
	HINT_PADDING_M,
	HINT_VERTICAL_OFFSET_M,
	HINT_WIDTH_M,
	MAQUETA_SCALE,
	MAQUETA_SIZE_M,
	MATRIX_FORWARD_COLUMN_INDEX,
	MATRIX_UP_Y_INDEX,
	MODEL_FRAME_PRIORITY,
	PLACEMENT_FALLBACK_DELAY_MS,
	PLACEMENT_FALLBACK_DISTANCE_M,
	PLACEMENT_FALLBACK_HEIGHT_M,
	QUARTER_TURN_RAD,
	RETICLE_INNER_RADIUS_M,
	RETICLE_OUTER_RADIUS_M,
	RETICLE_SEGMENTS_COUNT,
	RETICLE_SURFACE_OFFSET_M,
	SURFACE_MIN_UP_DOT_RATIO,
	XR_CAMERA_FAR_M,
	XR_CAMERA_NEAR_M,
} from "./constants";
import { StructureXrPanel } from "./panel";

interface StructureXrContentProps
	extends Omit<StructureXrSessionProps, "store"> {}

export function StructureXrContent({
	terrain,
	focus,
	labels,
	onUndo,
	children,
}: StructureXrContentProps) {
	const session = useXR((state) => state.session);
	const store = useXRStore();
	const mode = useXR((state) => state.mode);
	const isAr = Boolean(session) && mode === "immersive-ar";
	const scene = useThree((state) => state.scene);
	const renderer = useThree((state) => state.gl);
	const colors = useTokenColors(STRUCTURE_COLOR_TOKENS);
	const [placed, setPlaced] = useState(false);
	const [anchor, createAnchor] = useXRAnchor();
	const getAnchorMatrix = useGetXRSpaceMatrix(anchor?.anchorSpace);
	const tableGroup = useRef<Group>(null);
	const contentGroup = useRef<Group>(null);
	const modelGroup = useRef<Group>(null);
	const reticleGroup = useRef<Group>(null);
	const placementMatrix = useRef(new Matrix4());
	const hitMatrix = useRef(new Matrix4());
	const searchStartedAtMs = useRef<number | null>(null);
	const lastSurfaceAtMs = useRef<number | null>(null);
	const fallbackVisible = useRef(false);
	const hasPlacement = useRef(false);
	const fallbackPosition = useRef(new Vector3());
	const fallbackForward = useRef(new Vector3());
	const focusX = focus?.x ?? 0;
	const focusZ = focus?.z ?? 0;

	useEffect(() => {
		if (!isAr) return;
		terrain.setClip({
			center: { x: focusX, z: focusZ },
			sizeM: MAQUETA_SIZE_M,
		});
		return () => terrain.setClip(null);
	}, [terrain, isAr, focusX, focusZ]);

	useEffect(() => {
		if (session) return;
		setPlaced(false);
		hasPlacement.current = false;
		fallbackVisible.current = false;
		searchStartedAtMs.current = null;
		lastSurfaceAtMs.current = null;
		placementMatrix.current.identity();
	}, [session]);

	useEffect(() => {
		if (!isAr) return;
		const background = scene.background;
		const fog = scene.fog;
		const clearAlpha = renderer.getClearAlpha();
		const camera = renderer.xr.getCamera();
		const near = camera.near;
		const far = camera.far;
		camera.near = XR_CAMERA_NEAR_M;
		camera.far = XR_CAMERA_FAR_M;
		scene.background = null;
		scene.fog = null;
		renderer.setClearAlpha(0);
		return () => {
			scene.background = background;
			scene.fog = fog;
			renderer.setClearAlpha(clearAlpha);
			camera.near = near;
			camera.far = far;
		};
	}, [isAr, scene, renderer]);

	useEffect(() => {
		if (!session || !isAr) return;
		const placeAtReticle = (event: XRInputSourceEvent) => {
			const reticle = reticleGroup.current;
			if (
				store.getState().session !== session ||
				hasPlacement.current ||
				!reticle?.visible
			)
				return;
			placementMatrix.current.copy(reticle.matrix);
			hasPlacement.current = true;
			reticle.visible = false;
			setPlaced(true);
			// Anchors must be requested while the input event's XRFrame is still active.
			void createAnchor({
				relativeTo: "world",
				worldPosition: new Vector3().setFromMatrixPosition(
					placementMatrix.current,
				),
				worldQuaternion: new Quaternion().setFromRotationMatrix(
					placementMatrix.current,
				),
				frame: event.frame,
			}).catch(() => undefined);
		};
		session.addEventListener("select", placeAtReticle);
		return () => session.removeEventListener("select", placeAtReticle);
	}, [session, isAr, store, createAnchor]);

	useXRHitTest(
		(results, getWorldMatrix) => {
			const reticle = reticleGroup.current;
			if (!reticle || !isAr || hasPlacement.current) return;
			const surface = results.find(
				(result) =>
					getWorldMatrix(hitMatrix.current, result) &&
					(hitMatrix.current.elements[MATRIX_UP_Y_INDEX] ?? 0) >=
						SURFACE_MIN_UP_DOT_RATIO,
			);
			if (!surface) {
				reticle.visible = fallbackVisible.current;
				return;
			}
			lastSurfaceAtMs.current = performance.now();
			fallbackVisible.current = false;
			reticle.visible = true;
			reticle.matrix.copy(hitMatrix.current);
		},
		"viewer",
		"plane",
	);

	useFrame((_state, _delta, frame) => {
		const table = tableGroup.current;
		const content = contentGroup.current;
		const model = modelGroup.current;
		if (!table || !content || !model) return;
		const state = store.getState();
		const activeAr = Boolean(state.session) && state.mode === "immersive-ar";
		model.scale.setScalar(activeAr ? MAQUETA_SCALE : 1);
		table.visible = !activeAr || hasPlacement.current;
		if (!activeAr) {
			table.matrix.identity();
			content.position.set(0, 0, 0);
			content.visible = true;
			if (reticleGroup.current) reticleGroup.current.visible = false;
			return;
		}
		scene.background = null;
		scene.fog = null;
		if (!hasPlacement.current) {
			const nowMs = performance.now();
			searchStartedAtMs.current ??= nowMs;
			const lastSurfaceOrStartMs =
				lastSurfaceAtMs.current ?? searchStartedAtMs.current;
			const reticle = reticleGroup.current;
			if (
				!reticle ||
				nowMs - lastSurfaceOrStartMs < PLACEMENT_FALLBACK_DELAY_MS
			)
				return;
			fallbackVisible.current = true;
			const viewerCamera = renderer.xr.getCamera();
			fallbackForward.current
				.setFromMatrixColumn(
					viewerCamera.matrixWorld,
					MATRIX_FORWARD_COLUMN_INDEX,
				)
				.negate();
			fallbackForward.current.y = 0;
			if (fallbackForward.current.lengthSq() === 0)
				fallbackForward.current.set(0, 0, -1);
			fallbackForward.current.normalize();
			fallbackPosition.current
				.setFromMatrixPosition(viewerCamera.matrixWorld)
				.addScaledVector(
					fallbackForward.current,
					PLACEMENT_FALLBACK_DISTANCE_M,
				);
			fallbackPosition.current.y = PLACEMENT_FALLBACK_HEIGHT_M;
			reticle.matrix.makeTranslation(fallbackPosition.current);
			reticle.visible = true;
			return;
		}
		if (anchor) {
			getAnchorMatrix?.(table.matrix, frame);
		} else {
			table.matrix.copy(placementMatrix.current);
		}
		const focusElevationM = terrain.heightAt({ x: focusX, z: focusZ });
		content.visible = focusElevationM !== null;
		content.position.set(-focusX, -(focusElevationM ?? 0), -focusZ);
	}, MODEL_FRAME_PRIORITY);

	return (
		<>
			<group
				ref={tableGroup}
				matrixAutoUpdate={false}
				visible={!isAr || placed}
			>
				<group ref={modelGroup} scale={isAr ? MAQUETA_SCALE : 1}>
					<group ref={contentGroup}>{children}</group>
				</group>
				{isAr && placed ? (
					<StructureXrPanel
						labels={labels}
						onUndo={onUndo}
						onExit={() => void session?.end().catch(() => undefined)}
						colors={colors}
					/>
				) : null}
			</group>
			{isAr && !placed ? (
				<>
					<group ref={reticleGroup} matrixAutoUpdate={false} visible={false}>
						<mesh
							name="xr-placement-reticle"
							rotation-x={-QUARTER_TURN_RAD}
							position-y={RETICLE_SURFACE_OFFSET_M}
						>
							<ringGeometry
								args={[
									RETICLE_INNER_RADIUS_M,
									RETICLE_OUTER_RADIUS_M,
									RETICLE_SEGMENTS_COUNT,
								]}
							/>
							<meshBasicMaterial color={colors["--ring"]} />
						</mesh>
					</group>
					<XRSpace space="viewer">
						<group position={[0, HINT_VERTICAL_OFFSET_M, -HINT_DISTANCE_M]}>
							<mesh>
								<planeGeometry args={[HINT_WIDTH_M, HINT_HEIGHT_M]} />
								<meshBasicMaterial color={colors["--card"]} />
							</mesh>
							<Suspense fallback={null}>
								<Text
									position-z={RETICLE_SURFACE_OFFSET_M}
									fontSize={HINT_FONT_SIZE_M}
									maxWidth={HINT_WIDTH_M - HINT_PADDING_M}
									color={colors["--foreground"]}
									textAlign="center"
								>
									{labels.placeTable}
								</Text>
							</Suspense>
						</group>
					</XRSpace>
				</>
			) : null}
		</>
	);
}
