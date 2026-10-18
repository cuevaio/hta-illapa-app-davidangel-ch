import { terrainGradient } from "@hack-the-andes-project/business/structures/placement";
import type { Terrain } from "@hack-the-andes-project/terrain/types";
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { type Group, type Ray, Raycaster, Vector2, type Vector3 } from "three";
import type {
	PlacementTool,
	SceneCursor,
	StructurePoint,
} from "../../lib/structure-scene";
import {
	CURSOR_CHANGE_EPSILON_M,
	CURSOR_REPORT_INTERVAL_MS,
} from "./constants";
import { directPointer } from "./interaction";
import { pickPlacement, type TerrainPicker } from "./picking";

interface PointerPosition {
	x: number;
	y: number;
}
interface PendingPointer {
	ray: Ray;
	ground: Vector3 | null;
}
interface ScenePointerOptions {
	terrain: Terrain;
	picker: TerrainPicker;
	structureRoot: RefObject<Group | null>;
	placementTool: PlacementTool | null;
	dragging: boolean;
	presenting: boolean;
	canPlace: boolean;
	onCursorChange: (cursor: SceneCursor | null) => void;
}
export function useScenePointer({
	terrain,
	picker,
	structureRoot,
	placementTool,
	dragging,
	presenting,
	canPlace,
	onCursorChange,
}: ScenePointerOptions) {
	const renderer = useThree((state) => state.gl);
	const lastCursor = useRef<StructurePoint | null>(null);
	const [cursor, setCursor] = useState<StructurePoint | null>(null);
	const [screenPosition, setScreenPosition] = useState<PointerPosition | null>(
		null,
	);
	const currentCursor = useRef<StructurePoint | null>(null);
	const pendingPosition = useRef<PointerPosition | null>(null);
	const pendingPointer = useRef<PendingPointer | null>(null);
	const pointerOutside = useRef(false);
	const raycaster = useRef(new Raycaster());
	const normalizedPointer = useRef(new Vector2());
	const pendingReport = useRef<Vector3 | null | undefined>(undefined);
	const lastReported = useRef<Vector3 | null>(null);
	const lastReportAtMs = useRef(0);
	useEffect(() => {
		if (presenting) return;
		const canvas = renderer.domElement;
		const onMove = (event: PointerEvent) => {
			if (dragging) return;
			const bounds = canvas.getBoundingClientRect();
			pendingPosition.current = {
				x: event.clientX - bounds.left,
				y: event.clientY - bounds.top,
			};
			pointerOutside.current = false;
		};
		const onLeave = () => {
			pointerOutside.current = true;
			pendingPosition.current = null;
		};
		canvas.addEventListener("pointermove", onMove);
		canvas.addEventListener("pointerleave", onLeave);
		return () => {
			canvas.removeEventListener("pointermove", onMove);
			canvas.removeEventListener("pointerleave", onLeave);
		};
	}, [renderer, presenting, dragging]);
	const schedulePointer = useCallback(
		(event: ThreeEvent<PointerEvent>) => {
			let ground: Vector3 | null;
			if (directPointer(event.pointerType)) {
				ground = terrain.group.worldToLocal(event.point.clone());
				const heightM = terrain.heightAt(ground);
				ground = heightM === null ? null : ground.setY(heightM);
			} else ground = picker.pick(event.ray);
			pendingPointer.current = { ray: event.ray.clone(), ground };
			pointerOutside.current = false;
		},
		[picker, terrain],
	);
	useFrame(({ camera, size }) => {
		const position = pendingPosition.current;
		const pointer = pendingPointer.current;
		pendingPosition.current = null;
		pendingPointer.current = null;
		if (pointerOutside.current) {
			pointerOutside.current = false;
			pendingReport.current = null;
			if (currentCursor.current !== null) {
				currentCursor.current = null;
				setCursor(null);
			}
			setScreenPosition((current) => (current === null ? current : null));
		} else if ((position || pointer) && !dragging) {
			let ground = pointer?.ground ?? null;
			if (pointer) raycaster.current.ray.copy(pointer.ray);
			else if (position) {
				normalizedPointer.current.set(
					(position.x / size.width) * 2 - 1,
					-(position.y / size.height) * 2 + 1,
				);
				raycaster.current.setFromCamera(normalizedPointer.current, camera);
				ground = picker.pick(raycaster.current.ray);
			}
			pendingReport.current = ground;
			if (placementTool) {
				const hit = pickPlacement(
					terrain,
					raycaster.current,
					structureRoot.current,
					placementTool,
					ground,
					camera,
				);
				const previous = currentCursor.current;
				if (
					hit &&
					(!previous ||
						Math.hypot(
							previous.x - hit.x,
							previous.y - hit.y,
							previous.z - hit.z,
						) >= CURSOR_CHANGE_EPSILON_M)
				) {
					const next = { x: hit.x, y: hit.y, z: hit.z };
					lastCursor.current = next;
					currentCursor.current = next;
					setCursor(next);
				} else if (!hit && previous) {
					currentCursor.current = null;
					setCursor(null);
				}
				if (!hit && position)
					setScreenPosition((current) =>
						current?.x === position.x && current.y === position.y
							? current
							: position,
					);
			}
		}
		const report = pendingReport.current;
		if (
			report !== undefined &&
			performance.now() - lastReportAtMs.current >= CURSOR_REPORT_INTERVAL_MS
		) {
			pendingReport.current = undefined;
			const previous = lastReported.current;
			if (report === null && previous) {
				lastReported.current = null;
				onCursorChange(null);
			} else if (
				report &&
				(!previous || previous.distanceTo(report) >= CURSOR_CHANGE_EPSILON_M)
			) {
				lastReported.current = report.clone();
				onCursorChange({
					point: terrain.toGeo(report),
					elevationM: report.y,
					slopePercent: terrainGradient(report, terrain.heightAt).slopePercent,
				});
			}
			lastReportAtMs.current = performance.now();
		}
		picker.nextFrame();
	});
	const hasCursor = Boolean(cursor);
	useEffect(() => {
		renderer.domElement.style.cursor =
			placementTool && !presenting
				? hasCursor && canPlace
					? "crosshair"
					: "not-allowed"
				: "";
		return () => {
			renderer.domElement.style.cursor = "";
		};
	}, [placementTool, hasCursor, renderer, canPlace, presenting]);
	return {
		cursor,
		previewCursor: cursor ?? lastCursor.current,
		screenPosition,
		schedulePointer,
	};
}
