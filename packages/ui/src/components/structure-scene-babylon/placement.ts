import { PRIMITIVE_DEFAULTS } from "@hack-the-andes-project/business/structures/catalog";
import { MAX_STRUCTURE_EXTENT_M } from "@hack-the-andes-project/business/structures/constants";
import { createDefaultStructureTemplate } from "@hack-the-andes-project/business/structures/placement";
import type { BabylonTerrain } from "@hack-the-andes-project/terrain/babylon/types";
import type {
	PlacedStructure,
	PlacementTool,
	SceneStructure,
	StructurePoint,
} from "../../lib/structure-scene";
import { GRID_CELL_M } from "./constants";

export function createPlacement(
	terrain: BabylonTerrain,
	point: StructurePoint,
	tool: PlacementTool,
	primitiveId: string = crypto.randomUUID(),
): PlacedStructure {
	return {
		anchor: { ...terrain.toGeo(point), elevationM: point.y },
		template:
			"primitive" in tool
				? { kind: "entity" }
				: createDefaultStructureTemplate(tool.kind, point, (sample) =>
						terrain.heightAt(sample),
					),
		elements:
			"primitive" in tool
				? [
						{
							id: primitiveId,
							kind: tool.primitive,
							...PRIMITIVE_DEFAULTS[tool.primitive],
							position: { x: 0, y: 0, z: 0 },
							rotationDeg: { x: 0, y: 0, z: 0 },
						},
					]
				: [],
	};
}

export function clampPoint(point: StructurePoint): StructurePoint {
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

export function relativePoint(
	terrain: BabylonTerrain,
	structure: SceneStructure,
	point: StructurePoint,
): StructurePoint {
	const anchor = terrain.toLocal(structure.anchor);
	return clampPoint({
		x: point.x - anchor.x,
		y: point.y - structure.anchor.elevationM,
		z: point.z - anchor.z,
	});
}

export function snapHandlePoint(
	terrain: BabylonTerrain,
	structure: SceneStructure,
	point: StructurePoint,
): StructurePoint | null {
	const anchor = terrain.toLocal(structure.anchor);
	const snapped = relativePoint(terrain, structure, {
		x: Math.round(point.x / GRID_CELL_M) * GRID_CELL_M,
		y: point.y,
		z: Math.round(point.z / GRID_CELL_M) * GRID_CELL_M,
	});
	const heightM = terrain.heightAt({
		x: anchor.x + snapped.x,
		z: anchor.z + snapped.z,
	});
	return heightM === null
		? null
		: clampPoint({ ...snapped, y: heightM - structure.anchor.elevationM });
}
