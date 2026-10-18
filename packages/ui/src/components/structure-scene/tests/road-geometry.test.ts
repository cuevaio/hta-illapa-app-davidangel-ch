import { BYPASS_PARAMETERS } from "@hack-the-andes-project/business/structures/catalog";
import { bypassWidthM } from "@hack-the-andes-project/business/structures/geometry";
import { describe, expect, it } from "vitest";
import { createRoadGeometry } from "../road-geometry";
import {
	TEST_ANCHOR_ELEVATION_M,
	TEST_ROAD_GAP_END_M,
	TEST_ROAD_GAP_START_M,
	TEST_ROAD_LENGTH_M,
} from "./constants";
import { testTerrain } from "./terrain";

const options = {
	points: [
		{ x: 0, y: 0, z: 0 },
		{ x: TEST_ROAD_LENGTH_M, y: 0, z: 0 },
	],
	widthM: bypassWidthM({
		laneCount: BYPASS_PARAMETERS.laneCount.default,
		laneWidthM: BYPASS_PARAMETERS.laneWidthM.default,
	}),
	laneCount: BYPASS_PARAMETERS.laneCount.default,
	laneWidthM: BYPASS_PARAMETERS.laneWidthM.default,
	anchor: { x: 0, y: TEST_ANCHOR_ELEVATION_M, z: 0 },
};
describe("road coverage while terrain streams", () => {
	it("renders no asphalt polygon before ground heights are available", () => {
		const result = createRoadGeometry({
			...options,
			terrain: testTerrain({ heightAt: () => null }),
		});
		expect(result.geometry.index?.count).toBe(0);
		expect(
			result.markings.every((marking) => marking.segments.length === 0),
		).toBe(true);
		expect(result.leftEdges).toEqual([]);
		result.geometry.dispose();
	});
	it("never joins triangles or markings across missing terrain", () => {
		const result = createRoadGeometry({
			...options,
			terrain: testTerrain({
				heightAt: ({ x }) =>
					x >= TEST_ROAD_GAP_START_M && x <= TEST_ROAD_GAP_END_M
						? null
						: TEST_ANCHOR_ELEVATION_M,
			}),
		});
		const positions = result.geometry.attributes.position;
		const indices = result.geometry.index?.array;
		if (!indices || !positions) throw new Error("Missing road indices");
		for (
			let triangleIndex = 0;
			triangleIndex < indices.length;
			triangleIndex += 3
		) {
			const coordinates = Array.from(
				indices.slice(triangleIndex, triangleIndex + 3),
				(vertexIndex) => positions.getX(vertexIndex),
			);
			expect(
				Math.max(...coordinates) < TEST_ROAD_GAP_START_M ||
					Math.min(...coordinates) > TEST_ROAD_GAP_END_M,
			).toBe(true);
		}
		expect(result.markings[0]?.segments).toHaveLength(2);
		result.geometry.dispose();
	});
});
