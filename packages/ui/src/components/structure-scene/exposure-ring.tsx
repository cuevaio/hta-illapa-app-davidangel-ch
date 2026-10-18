import type { Terrain } from "@hack-the-andes-project/terrain/types";
import { useMemo } from "react";
import type { SceneStructure } from "../../lib/structure-scene";
import {
	EXPOSURE_RING_DASH_M,
	EXPOSURE_RING_GAP_M,
	EXPOSURE_RING_SEGMENTS_COUNT,
	FULL_TURN_RAD,
	GRID_LIFT_M,
	SELECTION_LINE_WIDTH_PX,
} from "./constants";

import { DecorativeLine } from "./decorations";

interface ExposureRingProps {
	terrain: Terrain;
	structure: SceneStructure;
	radiusM: number;
	color: string;
	terrainRevision: number;
}
export function ExposureRing({
	terrain,
	structure,
	radiusM,
	color,
	terrainRevision,
}: ExposureRingProps) {
	// biome-ignore lint/correctness/useExhaustiveDependencies: the terrain height cache changes without replacing the resource.
	const points = useMemo(() => {
		const anchor = terrain.toLocal(structure.anchor);
		return Array.from(
			{ length: EXPOSURE_RING_SEGMENTS_COUNT + 1 },
			(_, segmentIndex): [number, number, number] => {
				const angle =
					(FULL_TURN_RAD * segmentIndex) / EXPOSURE_RING_SEGMENTS_COUNT;
				const eastM = anchor.x + Math.cos(angle) * radiusM;
				const southM = anchor.z + Math.sin(angle) * radiusM;
				return [
					eastM,
					(terrain.heightAt({ x: eastM, z: southM }) ??
						structure.anchor.elevationM) + GRID_LIFT_M,
					southM,
				];
			},
		);
	}, [terrain, structure.anchor, radiusM, terrainRevision]);
	return (
		<DecorativeLine
			points={points}
			color={color}
			dashed
			dashSize={EXPOSURE_RING_DASH_M}
			gapSize={EXPOSURE_RING_GAP_M}
			lineWidth={SELECTION_LINE_WIDTH_PX}
		/>
	);
}
