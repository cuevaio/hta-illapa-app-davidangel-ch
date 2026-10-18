import { describe, expect, it } from "vitest";
import {
	buildLocalGrid,
	fillNodata,
	localTiles,
	Mosaic,
} from "../../src/map/localGrid";
import {
	groundResolution,
	lonLatToWorld,
	type TileId,
} from "../../src/map/tileMath";

/** A synthetic tile whose height is a linear function of the global pixel coordinate. */
function rampTile(
	id: TileId,
	size: number,
	f: (gx: number, gy: number) => number,
): Float32Array {
	const h = new Float32Array(size * size);
	for (let r = 0; r < size; r++)
		for (let c = 0; c < size; c++)
			h[r * size + c] = f(id.x * size + c, id.y * size + r);
	return h;
}

describe("mosaic", () => {
	it("stitches tiles and samples bilinearly at pixel centres", () => {
		const size = 4;
		const tiles: TileId[] = [
			{ z: 3, x: 2, y: 4 },
			{ z: 3, x: 3, y: 4 },
			{ z: 3, x: 2, y: 5 },
			{ z: 3, x: 3, y: 5 },
		];
		const m = Mosaic.forTiles(tiles, size);
		expect(m.width).toBe(8);
		expect(m.height).toBe(8);
		const f = (gx: number, gy: number) => gx * 10 + gy;
		for (const t of tiles) m.put(t, rampTile(t, size, f));
		// World x of the centre of global pixel 9 (tile x=2 → pixels 8..11) at z3, 4 px tiles.
		const n = 8 * size;
		expect(m.sampleWorld(9.5 / n, 17.5 / n)).toBeCloseTo(f(9, 17), 5);
		expect(m.sampleWorld(10 / n, 18 / n)).toBeCloseTo(f(9.5, 17.5), 5);
		// Outside the mosaic → NaN.
		expect(Number.isNaN(m.sampleWorld(0, 0))).toBe(true);
	});

	it("ignores nodata corners when sampling", () => {
		const t: TileId = { z: 0, x: 0, y: 0 };
		const m = Mosaic.forTiles([t], 2);
		m.put(t, Float32Array.from([10, Number.NaN, 10, 10]));
		expect(m.sampleWorld(0.5, 0.5)).toBeCloseTo(10, 6);
	});
});

describe("nodata fill", () => {
	it("fills holes from the mean of valid neighbours, growing inward", () => {
		const n = 3;
		const h = Float32Array.from([1, 1, 1, 1, Number.NaN, 1, 1, 1, 3]);
		expect(fillNodata(h, n, n)).toBe(1);
		expect(h[4]).toBeCloseTo((1 * 7 + 3) / 8, 6);
		const g = Float32Array.from([5, Number.NaN, Number.NaN, Number.NaN]);
		fillNodata(g, 2, 2);
		expect(Array.from(g)).toEqual([5, 5, 5, 5]);
	});

	it("throws in Spanish when there is no valid data at all", () => {
		expect(() =>
			fillNodata(Float32Array.from([Number.NaN, Number.NaN]), 2, 1),
		).toThrow(/sin datos/i);
	});
});

describe("local metric HeightGrid", () => {
	const lon = -77.04;
	const lat = -12.05;

	it("lists the z11 tiles under a local window", () => {
		const tiles = localTiles(lon, lat, 128 * 40, 11);
		expect(tiles.length).toBeGreaterThanOrEqual(1);
		expect(tiles.length).toBeLessThanOrEqual(4);
		expect(tiles.every((t) => t.z === 11)).toBe(true);
	});

	it("resamples in metres, scaling Web Mercator by cos(lat)", () => {
		const z = 11;
		const size = 512;
		const tiles = localTiles(lon, lat, 128 * 40, z);
		const m = Mosaic.forTiles(tiles, size);
		// Height grows 1 m per global pixel eastward: east-west gradient = 1 / (m/px).
		for (const t of tiles)
			m.put(
				t,
				rampTile(t, size, (gx) => gx - 585 * size),
			);
		const cell = 40;
		const grid = buildLocalGrid(m, lon, lat, 128, cell);
		expect(grid.resolution).toBe(128);
		expect(grid.cellSize).toBe(cell);
		expect(grid.heights).toHaveLength(128 * 128);
		const mpp = groundResolution(lat, z);
		const row = 64 * 128;
		const gradient =
			(grid.heights[row + 100] - grid.heights[row + 20]) / (80 * cell);
		expect(gradient).toBeCloseTo(1 / mpp, 3);
		// The centre cell samples (close to) the picked point.
		const w = lonLatToWorld(lon, lat);
		const expectedCentre = w.x * 2 ** z * size - 0.5 - 585 * size;
		expect((grid.heights[row + 63] + grid.heights[row + 64]) / 2).toBeCloseTo(
			expectedCentre,
			0,
		);
	});

	it("puts north at increasing j (z grows northward)", () => {
		const z = 11;
		const size = 512;
		const tiles = localTiles(lon, lat, 64 * 40, z);
		const m = Mosaic.forTiles(tiles, size);
		// Height grows southward (global pixel y grows southward).
		for (const t of tiles)
			m.put(
				t,
				rampTile(t, size, (_gx, gy) => gy - 1092 * size),
			);
		const grid = buildLocalGrid(m, lon, lat, 64, 40);
		expect(grid.heights[0]).toBeGreaterThan(grid.heights[63 * 64]);
	});

	it("fills nodata cells instead of leaving NaN", () => {
		const z = 11;
		const size = 512;
		const tiles = localTiles(lon, lat, 32 * 40, z);
		const m = Mosaic.forTiles(tiles, size);
		for (const t of tiles) {
			const h = rampTile(t, size, () => 200);
			for (let k = 0; k < h.length; k += 3) h[k] = Number.NaN;
			m.put(t, h);
		}
		const grid = buildLocalGrid(m, lon, lat, 32, 40);
		expect(
			grid.heights.every((v) => Number.isFinite(v) && Math.abs(v - 200) < 1e-3),
		).toBe(true);
	});
});
