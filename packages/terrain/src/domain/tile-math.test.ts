import { describe, expect, it } from "vitest";
import {
	ancestorUvTransform,
	childrenOf,
	lonLatToMercator,
	lonLatToTile,
	mercatorToLonLat,
	parentOf,
	parseTileKey,
	tileBoundsLonLat,
	tileBoundsMercator,
	tileKey,
	WORLD_HALF_SIZE,
} from "./tile-math";

describe("Web Mercator projection", () => {
	it("maps the origin to (0, 0)", () => {
		const mercator = lonLatToMercator(0, 0);
		expect(mercator.x).toBeCloseTo(0, 6);
		expect(mercator.y).toBeCloseTo(0, 6);
	});

	it("maps lon 180 to the world half size", () => {
		expect(lonLatToMercator(180, 0).x).toBeCloseTo(WORLD_HALF_SIZE, 3);
	});

	it("round-trips lon/lat through mercator meters", () => {
		const mercator = lonLatToMercator(-72.545, -13.163);
		const geographicPoint = mercatorToLonLat(mercator.x, mercator.y);
		expect(geographicPoint.lon).toBeCloseTo(-72.545, 9);
		expect(geographicPoint.lat).toBeCloseTo(-13.163, 9);
	});
});

describe("lonLatToTile", () => {
	it("returns tile 0/0/0 for any point at zoom 0", () => {
		expect(lonLatToTile(-75, -10, 0)).toEqual({ z: 0, x: 0, y: 0 });
	});

	it("splits the world into quadrants at zoom 1", () => {
		expect(lonLatToTile(-75, -10, 1)).toEqual({ z: 1, x: 0, y: 1 });
		expect(lonLatToTile(10, 45, 1)).toEqual({ z: 1, x: 1, y: 0 });
	});

	it("locates Machu Picchu in the expected zoom 10 tile", () => {
		expect(lonLatToTile(-72.545, -13.163, 10)).toEqual({
			z: 10,
			x: 305,
			y: 549,
		});
	});

	it("clamps out-of-range coordinates into valid tiles", () => {
		expect(lonLatToTile(180, -89.9, 3)).toEqual({ z: 3, x: 7, y: 7 });
	});
});

describe("tile bounds", () => {
	it("returns the whole world for tile 0/0/0", () => {
		const secondTile = tileBoundsLonLat({ z: 0, x: 0, y: 0 });
		expect(secondTile.west).toBeCloseTo(-180, 9);
		expect(secondTile.east).toBeCloseTo(180, 9);
		expect(secondTile.north).toBeCloseTo(85.0511, 3);
		expect(secondTile.south).toBeCloseTo(-85.0511, 3);
	});

	it("contains the point used to compute the tile", () => {
		const tile = lonLatToTile(-77.0428, -12.0464, 12);
		const secondTile = tileBoundsLonLat(tile);
		expect(-77.0428).toBeGreaterThanOrEqual(secondTile.west);
		expect(-77.0428).toBeLessThanOrEqual(secondTile.east);
		expect(-12.0464).toBeGreaterThanOrEqual(secondTile.south);
		expect(-12.0464).toBeLessThanOrEqual(secondTile.north);
	});

	it("has square mercator bounds whose size halves per zoom level", () => {
		const firstTile = tileBoundsMercator({ z: 4, x: 3, y: 8 });
		const secondTile = tileBoundsMercator({ z: 5, x: 6, y: 16 });
		expect(firstTile.maxX - firstTile.minX).toBeCloseTo(
			firstTile.maxY - firstTile.minY,
			6,
		);
		expect(secondTile.maxX - secondTile.minX).toBeCloseTo(
			(firstTile.maxX - firstTile.minX) / 2,
			6,
		);
		expect(secondTile.minX).toBeCloseTo(firstTile.minX, 6);
		expect(secondTile.maxY).toBeCloseTo(firstTile.maxY, 6);
	});
});

describe("tile keys and hierarchy", () => {
	it("round-trips a key", () => {
		expect(tileKey({ z: 7, x: 38, y: 66 })).toBe("7/38/66");
		expect(parseTileKey("7/38/66")).toEqual({ z: 7, x: 38, y: 66 });
	});

	it("computes children and parent consistently", () => {
		const tile = { z: 6, x: 19, y: 33 };
		const kids = childrenOf(tile);
		expect(kids).toHaveLength(4);
		for (const key of kids) {
			expect(key.z).toBe(7);
			expect(parentOf(key)).toEqual(tile);
		}
	});

	it("has no parent at zoom 0", () => {
		expect(parentOf({ z: 0, x: 0, y: 0 })).toBeNull();
	});
});

describe("ancestorUvTransform", () => {
	it("is the identity for the tile itself", () => {
		const tile = { z: 7, x: 40, y: 70 };
		expect(ancestorUvTransform(tile, tile)).toEqual({
			offsetU: 0,
			offsetV: 0,
			scale: 1,
		});
	});

	it("maps a grandchild into its quadrant of the ancestor texture", () => {
		// (z9, 4*10+3, 4*20+1) sits at column 3, row 1 of its z7 ancestor (10, 20).
		const uv = ancestorUvTransform(
			{ z: 9, x: 43, y: 81 },
			{ z: 7, x: 10, y: 20 },
		);
		expect(uv).toEqual({ offsetU: 0.75, offsetV: 0.25, scale: 0.25 });
	});

	it("rejects tiles that are not descendants", () => {
		expect(() =>
			ancestorUvTransform({ z: 9, x: 0, y: 0 }, { z: 7, x: 10, y: 20 }),
		).toThrow();
	});
});
