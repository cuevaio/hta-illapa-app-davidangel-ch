import type { Terrain } from "@hack-the-andes-project/terrain/types";
import { Html } from "@react-three/drei";
import { memo, useMemo } from "react";
import { Box3, Vector3 } from "three";
import type { SceneStructure } from "../../lib/structure-scene";
import { getStructureFramePoints } from "./camera-framing";
import {
	SELECTED_STRUCTURE_LABEL_Z_INDEX,
	STRUCTURE_LABEL_LIFT_M,
	STRUCTURE_LABEL_Z_INDEX,
} from "./constants";
import type { ScenePalette } from "./structure-model";

interface StructureLabelProps {
	structure: SceneStructure;
	terrain: Terrain;
	palette: ScenePalette;
	selected: boolean;
	terrainRevision: number;
}
export const StructureLabel = memo(function StructureLabel({
	structure,
	terrain,
	palette,
	selected,
	terrainRevision,
}: StructureLabelProps) {
	// biome-ignore lint/correctness/useExhaustiveDependencies: the terrain height cache changes without replacing the resource.
	const position = useMemo(() => {
		const bounds = new Box3().setFromPoints(
			getStructureFramePoints(structure, terrain),
		);
		const result = bounds.getCenter(new Vector3());
		result.y =
			Math.max(bounds.max.y, terrain.heightAt(result) ?? bounds.max.y) +
			STRUCTURE_LABEL_LIFT_M;
		return result;
	}, [structure, terrain, terrainRevision]);
	const zIndex = selected
		? SELECTED_STRUCTURE_LABEL_Z_INDEX
		: STRUCTURE_LABEL_Z_INDEX;
	return (
		<Html
			position={position}
			center
			pointerEvents="none"
			zIndexRange={[zIndex, zIndex]}
			style={{ pointerEvents: "none" }}
		>
			<div
				className="type-data w-max whitespace-nowrap rounded-md border px-2 py-1"
				style={{
					backgroundColor: palette.color("--card"),
					color: palette.color(selected ? "--primary" : "--foreground"),
					borderColor: palette.color(
						selected ? "--ring" : "--muted-foreground",
					),
				}}
			>
				{structure.name}
			</div>
		</Html>
	);
});
