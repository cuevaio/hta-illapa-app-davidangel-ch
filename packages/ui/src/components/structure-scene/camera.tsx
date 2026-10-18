import type { Terrain } from "@hack-the-andes-project/terrain/types";
import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { type ComponentRef, useEffect, useRef } from "react";
import { ArrayCamera, MOUSE, PerspectiveCamera, Vector3 } from "three";
import type {
	SceneCameraRequest,
	SceneInsets,
	SceneStructure,
} from "../../lib/structure-scene";
import { useIsPresenting } from "../structure-xr";
import { frameCameraPoints, getStructureFramePoints } from "./camera-framing";
import {
	CAMERA_DAMPING_RATIO,
	CAMERA_FAR_DISTANCE_RATIO,
	CAMERA_FAR_M,
	CAMERA_FOCUS_DURATION_MS,
	CAMERA_FOCUS_EASE_EXPONENT,
	CAMERA_FOCUSED_FAR_M,
	CAMERA_FRAME_PRIORITY,
	CAMERA_GROUND_CLEARANCE_M,
	CAMERA_INITIAL_EAST_M,
	CAMERA_INITIAL_HEIGHT_M,
	CAMERA_INITIAL_SOUTH_M,
	CAMERA_MAX_DISTANCE_M,
	CAMERA_MAX_POLAR_RAD,
	CAMERA_MIN_DISTANCE_M,
	CAMERA_NEAR_DISTANCE_RATIO,
	CAMERA_NEAR_M,
	CAMERA_OVERVIEW_FILL_RATIO,
	EXPOSURE_RING_SEGMENTS_COUNT,
	FULL_TURN_RAD,
	INITIAL_TERRAIN_ELEVATION_M,
} from "./constants";

interface CameraFlight {
	startedAtMs: number;
	fromPosition: Vector3;
	fromTarget: Vector3;
	toPosition: Vector3;
	toTarget: Vector3;
}
interface SceneCameraProps {
	terrain: Terrain;
	dragging: boolean;
	structures: SceneStructure[];
	cameraRequest: SceneCameraRequest | null;
	insets: SceneInsets;
}

function useStructureSceneCamera({
	terrain,
	dragging,
	structures,
	cameraRequest,
	insets,
}: SceneCameraProps) {
	const camera = useThree((state) => state.camera);
	const presenting = useIsPresenting();
	const viewportSize = useThree((state) => state.size);
	const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null);
	const flight = useRef<CameraFlight | null>(null);
	const trackingOrigin = useRef(false);
	const latestCamera = useRef(camera);
	latestCamera.current = camera;
	const latestViewport = useRef(viewportSize);
	latestViewport.current = viewportSize;
	const isPresenting = useRef(presenting);
	isPresenting.current = presenting;
	const framedTerrain = useRef<Terrain | null>(null);
	const handledRequest = useRef<number | undefined>(undefined);
	const latestStructures = useRef(structures);
	latestStructures.current = structures;
	const latestRequest = useRef(cameraRequest);
	latestRequest.current = cameraRequest;
	const requestId = cameraRequest?.requestId;
	useEffect(() => {
		if (presenting) flight.current = null;
	}, [presenting]);
	const latestInsets = useRef(insets);
	latestInsets.current = insets;
	useEffect(() => {
		if (
			presenting ||
			camera instanceof ArrayCamera ||
			!(camera instanceof PerspectiveCamera)
		)
			return;
		camera.setViewOffset(
			viewportSize.width,
			viewportSize.height,
			(insets.rightPx - insets.leftPx) / 2,
			(insets.bottomPx - insets.topPx) / 2,
			viewportSize.width,
			viewportSize.height,
		);
	}, [
		camera,
		presenting,
		viewportSize.width,
		viewportSize.height,
		insets.topPx,
		insets.rightPx,
		insets.bottomPx,
		insets.leftPx,
	]);
	useEffect(() => {
		const camera = latestCamera.current;
		const viewportSize = latestViewport.current;
		if (
			framedTerrain.current === terrain ||
			isPresenting.current ||
			camera instanceof ArrayCamera ||
			!(camera instanceof PerspectiveCamera)
		)
			return;
		framedTerrain.current = terrain;
		const elevationM =
			terrain.heightAt({ x: 0, z: 0 }) ?? INITIAL_TERRAIN_ELEVATION_M;
		const points = latestStructures.current.flatMap((structure) =>
			getStructureFramePoints(structure, terrain),
		);
		trackingOrigin.current = points.length === 0;
		const initialFrame = points.length
			? frameCameraPoints(
					camera,
					points,
					latestInsets.current,
					{ width: viewportSize.width, height: viewportSize.height },
					CAMERA_OVERVIEW_FILL_RATIO,
				)
			: {
					position: new Vector3(
						CAMERA_INITIAL_EAST_M,
						elevationM + CAMERA_INITIAL_HEIGHT_M,
						CAMERA_INITIAL_SOUTH_M,
					),
					target: new Vector3(0, elevationM, 0),
				};
		camera.position.copy(initialFrame.position);
		controlsRef.current?.target.copy(initialFrame.target);
		camera.lookAt(initialFrame.target);
		controlsRef.current?.update();
	}, [terrain]);
	useEffect(() => {
		const request = latestRequest.current;
		const camera = latestCamera.current;
		const viewportSize = latestViewport.current;
		if (handledRequest.current === requestId) return;
		handledRequest.current = requestId;
		if (isPresenting.current || camera instanceof ArrayCamera) return;
		if (
			!request ||
			requestId === undefined ||
			!(camera instanceof PerspectiveCamera)
		)
			return;
		const controls = controlsRef.current;
		if (controls) {
			const dampingEnabled = controls.enableDamping;
			controls.enableDamping = false;
			controls.update();
			controls.enableDamping = dampingEnabled;
		}
		let target =
			controlsRef.current?.target.clone() ??
			new Vector3(0, INITIAL_TERRAIN_ELEVATION_M, 0);
		let destination = camera.position.clone();
		trackingOrigin.current = false;
		if (request.kind === "north_up") {
			const offset = camera.position.clone().sub(target);
			destination = target
				.clone()
				.add(new Vector3(0, offset.y, Math.hypot(offset.x, offset.z)));
		} else {
			let points: Vector3[];
			if (request.kind === "overview")
				points = latestStructures.current.flatMap((structure) =>
					getStructureFramePoints(structure, terrain),
				);
			else if (request.kind === "focus_point") {
				const local = terrain.toLocal(request.point);
				points = [
					new Vector3(
						local.x,
						terrain.heightAt(local) ?? INITIAL_TERRAIN_ELEVATION_M,
						local.z,
					),
				];
			} else {
				const structure = latestStructures.current.find(
					(candidate) => candidate.id === request.structureId,
				);
				if (!structure) return;
				points = getStructureFramePoints(structure, terrain);
				if (request.kind === "frame_exposure") {
					const local = terrain.toLocal(structure.anchor);
					for (
						let segmentIndex = 0;
						segmentIndex < EXPOSURE_RING_SEGMENTS_COUNT;
						segmentIndex++
					) {
						const angle =
							(FULL_TURN_RAD * segmentIndex) / EXPOSURE_RING_SEGMENTS_COUNT;
						const point = {
							x: local.x + Math.cos(angle) * request.radiusM,
							z: local.z + Math.sin(angle) * request.radiusM,
						};
						points.push(
							new Vector3(
								point.x,
								terrain.heightAt(point) ?? structure.anchor.elevationM,
								point.z,
							),
						);
					}
				}
			}
			if (points.length) {
				const frame = frameCameraPoints(
					camera,
					points,
					latestInsets.current,
					{ width: viewportSize.width, height: viewportSize.height },
					request.kind === "overview" ? CAMERA_OVERVIEW_FILL_RATIO : undefined,
				);
				target = frame.target;
				destination = frame.position;
			} else {
				const originHeightM =
					terrain.heightAt({ x: 0, z: 0 }) ?? INITIAL_TERRAIN_ELEVATION_M;
				trackingOrigin.current = true;
				target = new Vector3(0, originHeightM, 0);
				destination.set(
					CAMERA_INITIAL_EAST_M,
					originHeightM + CAMERA_INITIAL_HEIGHT_M,
					CAMERA_INITIAL_SOUTH_M,
				);
			}
		}
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			flight.current = null;
			camera.position.copy(destination);
			controlsRef.current?.target.copy(target);
			controlsRef.current?.update();
			return;
		}
		flight.current = {
			startedAtMs: performance.now(),
			fromPosition: camera.position.clone(),
			fromTarget: controlsRef.current?.target.clone() ?? target.clone(),
			toPosition: destination,
			toTarget: target,
		};
	}, [requestId, terrain]);
	useFrame(({ camera: renderCamera }) => {
		const activeCamera = renderCamera;
		if (!isPresenting.current && !(activeCamera instanceof ArrayCamera)) {
			if (trackingOrigin.current && !flight.current) {
				const originHeightM = terrain.heightAt({ x: 0, z: 0 });
				if (originHeightM !== null) {
					activeCamera.position.y +=
						originHeightM -
						(controlsRef.current?.target.y ?? INITIAL_TERRAIN_ELEVATION_M);
					controlsRef.current?.target.set(0, originHeightM, 0);
					controlsRef.current?.update();
				}
			}
			const currentFlight = flight.current;
			if (currentFlight && !dragging) {
				const progress = Math.min(
					1,
					(performance.now() - currentFlight.startedAtMs) /
						CAMERA_FOCUS_DURATION_MS,
				);
				const easedProgress = 1 - (1 - progress) ** CAMERA_FOCUS_EASE_EXPONENT;
				activeCamera.position.lerpVectors(
					currentFlight.fromPosition,
					currentFlight.toPosition,
					easedProgress,
				);
				controlsRef.current?.target.lerpVectors(
					currentFlight.fromTarget,
					currentFlight.toTarget,
					easedProgress,
				);
				controlsRef.current?.update();
				if (progress === 1) flight.current = null;
			}
			const groundM = terrain.heightAt(activeCamera.position);
			if (
				groundM !== null &&
				activeCamera.position.y < groundM + CAMERA_GROUND_CLEARANCE_M
			)
				activeCamera.position.y = groundM + CAMERA_GROUND_CLEARANCE_M;
			if (activeCamera instanceof PerspectiveCamera) {
				const distanceM = controlsRef.current
					? activeCamera.position.distanceTo(controlsRef.current.target)
					: CAMERA_MAX_DISTANCE_M;
				const farM = Math.max(
					CAMERA_FOCUSED_FAR_M,
					Math.min(CAMERA_FAR_M, distanceM * CAMERA_FAR_DISTANCE_RATIO),
				);
				const nearM = Math.max(
					CAMERA_NEAR_M,
					distanceM * CAMERA_NEAR_DISTANCE_RATIO,
				);
				if (activeCamera.near !== nearM || activeCamera.far !== farM) {
					activeCamera.near = nearM;
					activeCamera.far = farM;
					activeCamera.updateProjectionMatrix();
				}
			}
			activeCamera.updateMatrixWorld(true);
		}
		terrain.update(activeCamera);
	}, CAMERA_FRAME_PRIORITY);
	return {
		controlsRef,
		cancelFlight: () => {
			flight.current = null;
			trackingOrigin.current = false;
		},
	};
}

export function SceneCamera(props: SceneCameraProps) {
	const renderer = useThree((state) => state.gl);
	const camera = useThree((state) => state.camera);
	const presenting = useIsPresenting();
	const { controlsRef, cancelFlight } = useStructureSceneCamera(props);
	return (
		<OrbitControls
			ref={controlsRef}
			camera={camera}
			domElement={renderer.domElement}
			makeDefault
			enabled={!props.dragging && !presenting}
			enableZoom
			enableDamping
			dampingFactor={CAMERA_DAMPING_RATIO}
			minDistance={CAMERA_MIN_DISTANCE_M}
			maxDistance={CAMERA_MAX_DISTANCE_M}
			maxPolarAngle={CAMERA_MAX_POLAR_RAD}
			mouseButtons={{
				LEFT: MOUSE.ROTATE,
				MIDDLE: MOUSE.DOLLY,
				RIGHT: MOUSE.PAN,
			}}
			zoomToCursor
			onStart={cancelFlight}
		/>
	);
}
