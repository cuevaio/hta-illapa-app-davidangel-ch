import { describe, expect, it } from "vitest";
import { createLocalFrame, mercatorToLocal } from "./local-frame";
import { type LodParams, selectTiles } from "./lod";
import { tileBoundsMercator, tileKey } from "./tile-math";

const frame = createLocalFrame(-75, -9.5);
const params: LodParams = {
	cameraPosition: { x: 0, y: 3_000_000, z: 0 },
	frustum: { intersectsBox: () => true },
	viewportHeightPx: 1000,
	fovYRadians: Math.PI / 3,
	frame,
	rootZoom: 0,
	maxZoom: 15,
	bounds: { west: -180, south: -85, east: 180, north: 85 },
	maxScreenSpaceError: 4,
	segments: 64,
	heightRange: { min: -12_000, max: 9000 },
	isReady: () => true,
	maxTiles: 300,
	clip: { center: { x: 0, z: 0 }, sizeM: 1000 },
};

describe("terrain clip LOD", () => {
	it("refines a 1 km square to the source maximum regardless of camera SSE", () => {
		const result = selectTiles(params);
		expect(result.display.length).toBeGreaterThan(0);
		expect(result.display.every((tile) => tile.z === 15)).toBe(true);
		expect(result.needed.size).toBeLessThanOrEqual(300);
		expect([...result.morph.values()].every((factor) => factor === 1)).toBe(
			true,
		);
		for (const key of result.display.map(tileKey))
			expect(result.needed.has(key)).toBe(true);
	});

	it("never displays or requests tiles fully outside the local square", () => {
		const result = selectTiles({ ...params, isReady: () => false });
		expect(result.requests.length).toBeGreaterThan(0);
		for (const request of result.requests) {
			const bounds = tileBoundsMercator(request.tile);
			const northwest = mercatorToLocal(frame, bounds.minX, bounds.maxY);
			const southeast = mercatorToLocal(frame, bounds.maxX, bounds.minY);
			expect(southeast.x).toBeGreaterThan(-500);
			expect(northwest.x).toBeLessThan(500);
			expect(southeast.z).toBeGreaterThan(-500);
			expect(northwest.z).toBeLessThan(500);
		}
	});

	it("retains ready parent coverage while the maximum detail loads", () => {
		const result = selectTiles({
			...params,
			isReady: (key) => key === "0/0/0",
		});
		expect(result.display).toEqual([{ z: 0, x: 0, y: 0 }]);
		expect(result.requests.some((request) => request.tile.z === 15)).toBe(true);
	});

	it("restores SSE selection when clipping is removed", () => {
		const clipped = selectTiles(params);
		const unbounded = selectTiles({
			...params,
			clip: null,
			previouslyRefined: clipped.refined,
		});
		expect(Math.max(...unbounded.display.map((tile) => tile.z))).toBeLessThan(
			15,
		);
	});
});
