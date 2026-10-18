import { PRIMITIVE_DEFAULTS } from "@hack-the-andes-project/business/structures/catalog";
import { createDefaultStructureTemplate } from "@hack-the-andes-project/business/structures/placement";
import type { Terrain } from "@hack-the-andes-project/terrain/types";
import type {
	PlacedStructure,
	PlacementTool,
	SceneStructure,
	StructurePoint,
} from "../../lib/structure-scene";

export function createPlacement(
	terrain: Terrain,
	point: StructurePoint,
	tool: PlacementTool,
	primitiveId?: string,
): PlacedStructure {
	const anchor = { ...terrain.toGeo(point), elevationM: point.y };
	if ("primitive" in tool) {
		return {
			anchor,
			template: { kind: "entity" },
			elements: [
				{
					id: primitiveId ?? crypto.randomUUID(),
					kind: tool.primitive,
					...PRIMITIVE_DEFAULTS[tool.primitive],
					position: { x: 0, y: 0, z: 0 },
					rotationDeg: { x: 0, y: 0, z: 0 },
				},
			],
		};
	}
	return {
		anchor,
		template: createDefaultStructureTemplate(
			tool.kind,
			point,
			terrain.heightAt,
		),
		elements: [],
	};
}

export function relativeToAnchor(
	terrain: Terrain,
	structure: SceneStructure,
	point: StructurePoint,
): StructurePoint {
	const anchor = terrain.toLocal(structure.anchor);
	return {
		x: point.x - anchor.x,
		y: point.y - structure.anchor.elevationM,
		z: point.z - anchor.z,
	};
}
