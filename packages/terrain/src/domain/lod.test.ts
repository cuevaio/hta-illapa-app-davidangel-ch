const PERU_BOUNDS = { west: -81.4, south: -18.4, east: -68.6, north: 0 };

import { describe, expect, it } from "vitest";
import { createLocalFrame, lonLatToLocal } from "./local-frame";
import {
	type LodParams,
	morphFactor,
	screenSpaceError,
	selectTiles,
} from "./lod";

import {
	lonLatToTile,
	parseTileKey,
	tileBoundsLonLat,
	tileKey,
} from "./tile-math";
import type { FrustumLike, TileId } from "./types";

const frame = createLocalFrame(-75, -9.5);
const acceptAll: FrustumLike = { intersectsBox: () => true };

function cameraAbove(lon: number, lat: number, altitudeMeters: number) {
	const localPoint = lonLatToLocal(frame, lon, lat);
	return { x: localPoint.x, y: altitudeMeters, z: localPoint.z };
}

function params(overrides: Partial<LodParams> = {}): LodParams {
	return {
		cameraPosition: cameraAbove(-75, -9.5, 3_000_000),
		frustum: acceptAll,
		viewportHeightPx: 1000,
		fovYRadians: Math.PI / 3,
		frame,
		rootZoom: 5,
		maxZoom: 14,
		bounds: PERU_BOUNDS,
		maxScreenSpaceError: 4,
		segments: 64,
		heightRange: { min: -500, max: 7000 },
		isReady: () => true,
		...overrides,
	};
}

function contains(tile: TileId, lon: number, lat: number): boolean {
	const secondTile = tileBoundsLonLat(tile);
	return (
		lon >= secondTile.west &&
		lon < secondTile.east &&
		lat > secondTile.south &&
		lat <= secondTile.north
	);
}

function isAncestor(firstTile: TileId, secondTile: TileId): boolean {
	if (firstTile.z >= secondTile.z) return false;
	const shift = secondTile.z - firstTile.z;
	return (
		secondTile.x >> shift === firstTile.x &&
		secondTile.y >> shift === firstTile.y
	);
}

/** Counts how many display tiles cover each sample point inside Peru. */
function coverageCounts(display: TileId[]): number[] {
	const counts: number[] = [];
	for (let index = 0; index <= 20; index++) {
		for (let rowIndex = 0; rowIndex <= 20; rowIndex++) {
			const lon =
				PERU_BOUNDS.west +
				((PERU_BOUNDS.east - PERU_BOUNDS.west) * (index + 0.5)) / 21.5;
			const lat =
				PERU_BOUNDS.south +
				((PERU_BOUNDS.north - PERU_BOUNDS.south) * (rowIndex + 0.5)) / 21.5;
			counts.push(display.filter((tile) => contains(tile, lon, lat)).length);
		}
	}
	return counts;
}

describe("selectTiles", () => {
	it("stays coarse when the camera is far away", () => {
		const { display } = selectTiles(params());
		expect(display.length).toBeGreaterThan(0);
		expect(Math.max(...display.map((tile) => tile.z))).toBeLessThanOrEqual(7);
	});

	it("refines near the camera and stays coarse far from it", () => {
		const { display } = selectTiles(
			params({ cameraPosition: cameraAbove(-72.545, -13.163, 4000) }),
		);
		const near = display.find((tile) => contains(tile, -72.545, -13.163));
		expect(near).toBeDefined();
		expect(near?.z).toBeGreaterThanOrEqual(12);
		const far = display.find((tile) => contains(tile, -80.5, -4));
		expect(far).toBeDefined();
		expect(far?.z).toBeLessThan(Number(near?.z) - 3);
	});

	it("never exceeds the maximum zoom", () => {
		const { display, requests } = selectTiles(
			params({
				cameraPosition: cameraAbove(-72.545, -13.163, 2500),
				maxZoom: 11,
			}),
		);
		expect(Math.max(...display.map((tile) => tile.z))).toBe(11);
		expect(requests.every((request) => request.tile.z <= 11)).toBe(true);
	});

	it("covers every point in Peru exactly once when all tiles are ready", () => {
		const { display } = selectTiles(
			params({ cameraPosition: cameraAbove(-76, -11, 20_000) }),
		);
		expect(
			coverageCounts(display).every((coverageCount) => coverageCount === 1),
		).toBe(true);
	});

	it("never returns a parent together with one of its children", () => {
		const { display } = selectTiles(
			params({
				cameraPosition: cameraAbove(-76, -11, 20_000),
				isReady: (key) => Number(key.split("/")[0]) <= 9,
			}),
		);
		for (const firstTile of display) {
			for (const secondTile of display)
				expect(isAncestor(firstTile, secondTile)).toBe(false);
		}
	});

	it("falls back to ready ancestors so no holes appear while children load", () => {
		const ready = (key: string) => Number(key.split("/")[0]) <= 7;
		const { display, requests } = selectTiles(
			params({
				cameraPosition: cameraAbove(-72.545, -13.163, 4000),
				isReady: ready,
			}),
		);
		expect(display.every((tile) => ready(tileKey(tile)))).toBe(true);
		expect(
			coverageCounts(display).every((coverageCount) => coverageCount === 1),
		).toBe(true);
		expect(requests.some((request) => request.tile.z > 7)).toBe(true);
		expect(
			requests
				.filter((request) => !request.prefetch)
				.every((request) => !ready(request.key)),
		).toBe(true);
	});

	it("requests coarse tiles before fine ones", () => {
		const { requests } = selectTiles(
			params({
				cameraPosition: cameraAbove(-72.545, -13.163, 4000),
				isReady: () => false,
			}),
		);
		expect(requests.length).toBeGreaterThan(0);
		for (let index = 1; index < requests.length; index++) {
			expect(requests[index]?.priority).toBeGreaterThanOrEqual(
				Number(requests[index - 1]?.priority),
			);
		}
		expect(requests[0]?.tile.z).toBe(5);
	});

	it("culls tiles outside the Peru bounds", () => {
		const { display } = selectTiles(
			params({ cameraPosition: cameraAbove(-76, -11, 20_000) }),
		);
		for (const tile of display) {
			const secondTile = tileBoundsLonLat(tile);
			const overlaps =
				secondTile.east > PERU_BOUNDS.west &&
				secondTile.west < PERU_BOUNDS.east &&
				secondTile.north > PERU_BOUNDS.south &&
				secondTile.south < PERU_BOUNDS.north;
			expect(overlaps).toBe(true);
		}
	});

	it("culls tiles outside the view frustum", () => {
		const rejectAll: FrustumLike = { intersectsBox: () => false };
		const result = selectTiles(params({ frustum: rejectAll }));
		expect(result.display).toEqual([]);
		expect(result.requests).toEqual([]);
	});
});

describe("LOD hysteresis and prefetch", () => {
	// A tiny region inside one z5 tile keeps the quadtree to a single root.
	const region = { west: -72.6, south: -13.2, east: -72.5, north: -13.1 };
	const root = lonLatToTile(-72.55, -13.15, 5);
	const rootKey = tileKey(root);
	const base = params({
		bounds: region,
		maxZoom: 6,
		cameraPosition: cameraAbove(-72.55, -13.15, 400_000),
	});
	const rootSse = screenSpaceError(root, base);
	/** Threshold that places the root's SSE at `ratio` of it. */
	const thresholdFor = (ratio: number) => rootSse / ratio;

	it("keeps a refined tile refined while its SSE stays above the coarsen threshold", () => {
		const result = selectTiles({
			...base,
			maxScreenSpaceError: thresholdFor(0.85),
			previouslyRefined: new Set([rootKey]),
		});
		expect(result.display.length).toBeGreaterThan(0);
		expect(result.display.every((tile) => tile.z === 6)).toBe(true);
		expect(result.refined.has(rootKey)).toBe(true);
	});

	it("does not refine a coarse tile until its SSE exceeds the refine threshold", () => {
		const result = selectTiles({
			...base,
			maxScreenSpaceError: thresholdFor(0.85),
			previouslyRefined: new Set(),
		});
		expect(result.display).toEqual([root]);
		expect(result.refined.has(rootKey)).toBe(false);
	});

	it("coarsens a refined tile once its SSE drops below the coarsen threshold", () => {
		const result = selectTiles({
			...base,
			maxScreenSpaceError: thresholdFor(0.7),
			previouslyRefined: new Set([rootKey]),
		});
		expect(result.display).toEqual([root]);
		expect(result.refined.has(rootKey)).toBe(false);
	});

	it("refines past the threshold regardless of the previous frame", () => {
		const result = selectTiles({
			...base,
			maxScreenSpaceError: thresholdFor(1.2),
		});
		expect(result.display.every((tile) => tile.z === 6)).toBe(true);
		expect(result.refined.has(rootKey)).toBe(true);
	});

	it("prefetches children near the threshold without displaying them", () => {
		const result = selectTiles({
			...base,
			maxScreenSpaceError: thresholdFor(0.72),
			isReady: (key) => key === rootKey,
		});
		expect(result.display).toEqual([root]);
		const prefetch = result.requests.filter((request) => request.prefetch);
		expect(prefetch.length).toBeGreaterThan(0);
		expect(prefetch.every((request) => request.tile.z === 6)).toBe(true);
	});

	it("does not prefetch when the SSE is well below the threshold", () => {
		const result = selectTiles({
			...base,
			maxScreenSpaceError: thresholdFor(0.5),
			isReady: (key) => key === rootKey,
		});
		expect(result.requests).toEqual([]);
	});

	it("gives prefetch requests lower priority than needed tiles and bounds their count", () => {
		const ready = (key: string) => Number(key.split("/")[0]) <= 9;
		const result = selectTiles(
			params({
				cameraPosition: cameraAbove(-72.545, -13.163, 4000),
				isReady: ready,
				maxPrefetch: 5,
			}),
		);
		const needed = result.requests.filter((request) => !request.prefetch);
		const prefetch = result.requests.filter((request) => request.prefetch);
		expect(needed.length).toBeGreaterThan(0);
		expect(prefetch.length).toBeGreaterThan(0);
		expect(prefetch.length).toBeLessThanOrEqual(5);
		const worstNeeded = Math.max(...needed.map((request) => request.priority));
		expect(prefetch.every((request) => request.priority > worstNeeded)).toBe(
			true,
		);
		expect(result.requests.every((request) => !ready(request.key))).toBe(true);
		const shown = new Set(result.display.map(tileKey));
		expect(prefetch.some((request) => shown.has(request.key))).toBe(false);
	});

	it("reports a morph factor in [0, 1] for every displayed tile, full detail at the roots", () => {
		const result = selectTiles(
			params({ cameraPosition: cameraAbove(-76, -11, 20_000) }),
		);
		for (const tile of result.display) {
			const mercator = result.morph.get(tileKey(tile));
			expect(mercator).toBeDefined();
			expect(Number(mercator)).toBeGreaterThanOrEqual(0);
			expect(Number(mercator)).toBeLessThanOrEqual(1);
		}
		const far = selectTiles(params());
		for (const tile of far.display.filter(
			(displayedTile) => displayedTile.z === 5,
		))
			expect(far.morph.get(tileKey(tile))).toBe(1);
	});
});

describe("morphFactor", () => {
	const tile = 4;

	it("is 0 when the parent just crossed the refine threshold", () => {
		expect(morphFactor(tile, tile)).toBe(0);
		expect(morphFactor(tile * 0.5, tile)).toBe(0);
	});

	it("reaches full detail by the time the tile itself could coarsen", () => {
		// Parent SSE is at least twice the child SSE, so 2 * 0.75 * t covers the coarsen point.
		expect(morphFactor(2 * 0.75 * tile, tile)).toBe(1);
		expect(morphFactor(10 * tile, tile)).toBe(1);
		expect(morphFactor(Number.POSITIVE_INFINITY, tile)).toBe(1);
	});

	it("is monotone and clamped to [0, 1]", () => {
		let previous = -1;
		for (let sample = 0; sample <= 3 * tile; sample += 0.01) {
			const mercator = morphFactor(sample, tile);
			expect(mercator).toBeGreaterThanOrEqual(0);
			expect(mercator).toBeLessThanOrEqual(1);
			expect(mercator).toBeGreaterThanOrEqual(previous);
			previous = mercator;
		}
	});
});

describe("LOD working set and tile budget", () => {
	const close = cameraAbove(-72.545, -13.163, 4000);

	it("reports every visited tile as needed, including ready ancestors and ready children of incomplete refinements", () => {
		// One z9 tile on the refinement path is missing, so its ready siblings stay undisplayed.
		const full = selectTiles(params({ cameraPosition: close }));
		const missingTile = lonLatToTile(-72.545, -13.163, 9);
		const missing = tileKey(missingTile);
		const underMissing = (key: string) => {
			const tile = parseTileKey(key);
			return key === missing || isAncestor(missingTile, tile);
		};
		const result = selectTiles(
			params({ cameraPosition: close, isReady: (key) => !underMissing(key) }),
		);
		const shown = new Set(result.display.map(tileKey));
		for (const key of shown) expect(result.needed.has(key)).toBe(true);
		for (const request of result.requests.filter(
			(request) => !request.prefetch,
		))
			expect(result.needed.has(request.key)).toBe(true);
		const parent = lonLatToTile(-72.545, -13.163, 8);
		expect(shown.has(tileKey(parent))).toBe(true);
		// Ready siblings of the missing child are not displayed but must be kept.
		const siblings = [0, 1, 2, 3]
			.map((index) =>
				tileKey({
					z: 9,
					x: parent.x * 2 + (index & 1),
					y: parent.y * 2 + (index >> 1),
				}),
			)
			.filter((key) => key !== missing);
		expect(siblings).toHaveLength(3);
		for (const key of siblings) expect(result.needed.has(key)).toBe(true);
		for (const key of siblings) expect(shown.has(key)).toBe(false);
		// Ancestors of displayed tiles are visited too.
		for (const tile of full.display) {
			for (let z = 5; z < tile.z; z++)
				expect(
					full.needed.has(
						tileKey({
							z,
							x: tile.x >> (tile.z - z),
							y: tile.y >> (tile.z - z),
						}),
					),
				).toBe(true);
		}
	});

	it("keeps the working set within maxTiles by refining less, without holes or overlaps", () => {
		const unbounded = selectTiles(params({ cameraPosition: close }));
		expect(unbounded.needed.size).toBeGreaterThan(150);
		const budget = 120;
		const result = selectTiles(
			params({ cameraPosition: close, maxTiles: budget }),
		);
		expect(result.needed.size).toBeLessThanOrEqual(budget);
		expect(result.needed.size).toBeGreaterThan(budget - 8);
		expect(
			coverageCounts(result.display).every(
				(coverageCount) => coverageCount === 1,
			),
		).toBe(true);
		const maxZ = (request: typeof result) =>
			Math.max(...request.display.map((tile) => tile.z));
		expect(maxZ(result)).toBeLessThanOrEqual(maxZ(unbounded));
	});

	it("does not change the selection when the budget is not reached", () => {
		const unbounded = selectTiles(params({ cameraPosition: close }));
		const result = selectTiles(
			params({ cameraPosition: close, maxTiles: unbounded.needed.size }),
		);
		expect(result.display.map(tileKey).sort()).toEqual(
			unbounded.display.map(tileKey).sort(),
		);
	});
});
