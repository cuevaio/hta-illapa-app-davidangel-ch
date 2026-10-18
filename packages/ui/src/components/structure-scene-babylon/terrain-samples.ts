import { bypassWidthM } from "@hack-the-andes-project/business/structures/geometry";
import type { BabylonTerrain } from "@hack-the-andes-project/terrain/babylon/types";
import type { SceneStructure } from "../../lib/structure-scene";
import {
	HALF_RATIO,
	MIN_GEOMETRY_LENGTH_M,
	ROAD_SAMPLE_SPACING_M,
} from "./constants";

export interface TerrainSample {
	x: number;
	z: number;
	heightM: number | null;
}

export function collectTerrainSamples(
	structure: SceneStructure,
	terrain: BabylonTerrain,
): TerrainSample[] {
	const anchor = terrain.toLocal(structure.anchor);
	const samples: TerrainSample[] = [
		{ ...anchor, heightM: terrain.heightAt(anchor) },
	];
	const template = structure.template;
	const points =
		template.kind === "entity"
			? []
			: template.kind === "bypass"
				? template.points
				: [template.start, template.end];
	for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
		const start = points[pointIndex - 1];
		const end = points[pointIndex];
		if (!start || !end) continue;
		const lengthM = Math.hypot(end.x - start.x, end.z - start.z);
		const segments =
			template.kind === "bypass"
				? Math.max(1, Math.ceil(lengthM / ROAD_SAMPLE_SPACING_M))
				: template.kind === "bridge"
					? template.pierCount + 1
					: 1;
		const widthM = template.kind === "bypass" ? bypassWidthM(template) : 0;
		const acrossX =
			-(end.z - start.z) / Math.max(lengthM, MIN_GEOMETRY_LENGTH_M);
		const acrossZ =
			(end.x - start.x) / Math.max(lengthM, MIN_GEOMETRY_LENGTH_M);
		for (let segment = 0; segment <= segments; segment++) {
			for (const side of widthM ? [-1, 0, 1] : [0]) {
				const point = {
					x:
						anchor.x +
						start.x +
						((end.x - start.x) * segment) / segments +
						acrossX * widthM * HALF_RATIO * side,
					z:
						anchor.z +
						start.z +
						((end.z - start.z) * segment) / segments +
						acrossZ * widthM * HALF_RATIO * side,
				};
				samples.push({ ...point, heightM: terrain.heightAt(point) });
			}
		}
	}
	return samples;
}
