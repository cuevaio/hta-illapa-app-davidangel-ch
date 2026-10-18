import { MAX_STRUCTURE_EXTENT_M } from "@hack-the-andes-project/business/structures/constants";
import type { Terrain } from "@hack-the-andes-project/terrain/types";
import type { Ray, Vector3 } from "three";
import type { StructurePoint } from "../../lib/structure-scene";
import {
	GRID_CELL_M,
	PLACEMENT_CLICK_THRESHOLD_PX,
	XR_CLICK_MOVEMENT_M,
} from "./constants";

export interface PointerSample {
	pointerId?: number;
	pointerType?: string;
	clientX?: number;
	clientY?: number;
	point: Vector3;
}
export interface TerrainPointerSample extends PointerSample {
	ray: Ray;
}
interface PointerStart {
	clientX?: number;
	clientY?: number;
	point: Vector3;
}

export class PointerGestures {
	private starts = new Map<number | undefined, PointerStart>();
	private lastStart: PointerStart | undefined;
	down(event: PointerSample) {
		const start = {
			clientX: event.clientX,
			clientY: event.clientY,
			point: event.point.clone(),
		};
		this.starts.set(event.pointerId, start);
		this.lastStart = start;
	}
	isClick(event: PointerSample): boolean {
		const start = this.starts.get(event.pointerId) ?? this.lastStart;
		if (!start) return false;
		if (
			event.pointerType === "ray" ||
			event.pointerType === "grab" ||
			event.pointerType === "touch"
		)
			return start.point.distanceTo(event.point) <= XR_CLICK_MOVEMENT_M;
		const initial = start;
		return event.clientX !== undefined &&
			event.clientY !== undefined &&
			initial.clientX !== undefined &&
			initial.clientY !== undefined
			? Math.hypot(
					event.clientX - initial.clientX,
					event.clientY - initial.clientY,
				) < PLACEMENT_CLICK_THRESHOLD_PX
			: start.point.distanceTo(event.point) <= XR_CLICK_MOVEMENT_M;
	}
}

export function directPointer(pointerType: string): boolean {
	return pointerType === "grab" || pointerType === "touch";
}

export function groundFromPointer(
	terrain: Terrain,
	event: TerrainPointerSample,
): Vector3 | null {
	if (!directPointer(event.pointerType ?? "")) return terrain.pick(event.ray);
	const point = terrain.group.worldToLocal(event.point.clone());
	const heightM = terrain.heightAt(point);
	return heightM === null ? null : point.setY(heightM);
}

export function clampStructurePoint(point: StructurePoint): StructurePoint {
	return {
		x: Math.max(
			-MAX_STRUCTURE_EXTENT_M,
			Math.min(MAX_STRUCTURE_EXTENT_M, point.x),
		),
		y: Math.max(
			-MAX_STRUCTURE_EXTENT_M,
			Math.min(MAX_STRUCTURE_EXTENT_M, point.y),
		),
		z: Math.max(
			-MAX_STRUCTURE_EXTENT_M,
			Math.min(MAX_STRUCTURE_EXTENT_M, point.z),
		),
	};
}

export function snapHandlePoint(
	terrain: Terrain,
	anchor: StructurePoint,
	point: StructurePoint,
): StructurePoint | null {
	const clamped = clampStructurePoint({
		x: Math.round(point.x / GRID_CELL_M) * GRID_CELL_M - anchor.x,
		y: point.y - anchor.y,
		z: Math.round(point.z / GRID_CELL_M) * GRID_CELL_M - anchor.z,
	});
	const heightM = terrain.heightAt({
		x: anchor.x + clamped.x,
		z: anchor.z + clamped.z,
	});
	return heightM === null
		? null
		: clampStructurePoint({ ...clamped, y: heightM - anchor.y });
}
