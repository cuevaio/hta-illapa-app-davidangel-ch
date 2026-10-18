import { describe, expect, it } from "vitest";
import { tileWorldBox } from "../../src/map/lod/quadtree";
import { lonLatToWorld, type TileId } from "../../src/map/tileMath";
import {
	decodeGridBands,
	lonLatToMercator,
	mercatorBoxToWorld,
	mercatorToGridUv,
	parseGridMeta,
	sampleGrid,
	sampleGridLonLat,
	tileGridUv,
	worldToBoxUv,
} from "../../src/map/weather/grid";

// The backend's real extent (tiles bbox + 2°): GET /api/layers/gfs-t2m/{time}/meta.
const BOUNDS = {
	minX: -9295177.481238343,
	minY: -2332357.8126193313,
	maxX: -7402746.137752692,
	maxY: 244963.0806270098,
};

function meta(extra: Record<string, unknown> = {}) {
	return {
		id: "20261018T0900Z",
		product: "gfs-t2m",
		validTime: "2026-10-18T09:00:00Z",
		issueTime: "2026-10-18T06:00:00Z",
		forecastHour: 3,
		units: "°C",
		bands: ["value"],
		width: 2,
		height: 2,
		mercatorBounds: BOUNDS,
		encoding: {
			type: "uint16",
			byteOrder: "little",
			scale: 0.5,
			offset: -10,
			nodata: 65535,
		},
		...extra,
	};
}

function u16(values: number[]): ArrayBuffer {
	const b = new ArrayBuffer(values.length * 2);
	const v = new DataView(b);
	values.forEach((x, i) => {
		v.setUint16(i * 2, x, true);
	});
	return b;
}

describe("weather grid metadata and decoding", () => {
	it("parses the per-time metadata (times as epoch ms, one band for scalars)", () => {
		const m = parseGridMeta(meta())!;
		expect(m).toMatchObject({
			timeId: "20261018T0900Z",
			layer: "gfs-t2m",
			width: 2,
			height: 2,
			forecastHour: 3,
			nodata: 65535,
		});
		expect(m.validTime).toBe(Date.UTC(2026, 9, 18, 9));
		expect(m.issueTime).toBe(Date.UTC(2026, 9, 18, 6));
		expect(m.bands).toEqual([{ name: "value", scale: 0.5, offset: -10 }]);
		expect(m.bounds).toEqual(BOUNDS);
	});

	it("rejects unusable metadata", () => {
		expect(parseGridMeta(null)).toBeNull();
		expect(parseGridMeta(meta({ width: 0 }))).toBeNull();
		expect(
			parseGridMeta(meta({ mercatorBounds: { ...BOUNDS, minX: BOUNDS.maxX } })),
		).toBeNull();
		expect(
			parseGridMeta(
				meta({ encoding: { type: "float32", scale: 1, offset: 0, nodata: 0 } }),
			),
		).toBeNull();
	});

	it("decodes value = raw × scale + offset (little endian) and 65535 as no data", () => {
		const m = parseGridMeta(meta())!;
		const [band] = decodeGridBands(u16([0, 20, 65535, 100]), m);
		expect(Array.from(band.slice(0, 2))).toEqual([-10, 0]);
		expect(Number.isNaN(band[2])).toBe(true);
		expect(band[3]).toBe(40);
	});

	it("decodes band-sequential multi-band grids with per-band scale/offset (wind u, v)", () => {
		const m = parseGridMeta(
			meta({
				bands: ["u", "v"],
				encoding: {
					type: "uint16",
					byteOrder: "little",
					nodata: 65535,
					bands: [
						{ name: "u", scale: 0.1, offset: -5 },
						{ name: "v", scale: 0.2, offset: -1 },
					],
				},
			}),
		)!;
		expect(m.bands.map((b) => b.name)).toEqual(["u", "v"]);
		const [u, v] = decodeGridBands(u16([50, 60, 65535, 0, 10, 20, 30, 40]), m);
		expect(Array.from(u.slice(0, 2)).map((x) => +x.toFixed(4))).toEqual([0, 1]);
		expect(Number.isNaN(u[2])).toBe(true);
		expect(Array.from(v).map((x) => +x.toFixed(4))).toEqual([1, 3, 5, 7]);
	});

	it("refuses a buffer of the wrong size", () => {
		expect(() =>
			decodeGridBands(u16([1, 2, 3]), parseGridMeta(meta())!),
		).toThrow(/expected 8 B/);
	});
});

describe("Web Mercator lon/lat ↔ grid UV against mercatorBounds", () => {
	it("maps the bounds corners to UV (0, 0) north-west and (1, 1) south-east", () => {
		expect(mercatorToGridUv(BOUNDS, BOUNDS.minX, BOUNDS.maxY)).toEqual({
			u: 0,
			v: 0,
		});
		expect(mercatorToGridUv(BOUNDS, BOUNDS.maxX, BOUNDS.minY)).toEqual({
			u: 1,
			v: 1,
		});
		const nw = lonLatToMercator(-83.5, 2.2);
		expect(nw.x).toBeCloseTo(BOUNDS.minX, 3);
		expect(nw.y).toBeCloseTo(BOUNDS.maxY, 3);
	});

	it("the world (unit square) box of the bounds gives the same UV as the mercator metres (what the shader does)", () => {
		const box = mercatorBoxToWorld(BOUNDS);
		for (const [lon, lat] of [
			[-77.04, -12.05],
			[-70, -15],
			[-83.5, 2.2],
			[-66.5, -20.5],
		]) {
			const m = lonLatToMercator(lon, lat);
			const a = mercatorToGridUv(BOUNDS, m.x, m.y);
			const w = lonLatToWorld(lon, lat);
			const b = worldToBoxUv(box, w.x, w.y);
			expect(b.u).toBeCloseTo(a.u, 9);
			expect(b.v).toBeCloseTo(a.v, 9);
		}
	});

	it("a tile UV maps affinely into grid UV (offset + uv × scale)", () => {
		const box = mercatorBoxToWorld(BOUNDS);
		const tile: TileId = { z: 7, x: 36, y: 66 };
		const t = tileGridUv(tileWorldBox(tile), box);
		const wb = tileWorldBox(tile);
		const far = worldToBoxUv(box, wb.maxX, wb.maxY);
		expect(t.u0 + t.du).toBeCloseTo(far.u, 12);
		expect(t.v0 + t.dv).toBeCloseTo(far.v, 12);
		expect(worldToBoxUv(box, wb.minX, wb.minY)).toEqual({ u: t.u0, v: t.v0 });
	});

	it("samples bilinearly with pixel centres at (i + 0.5) / n and no data as null", () => {
		const g = {
			width: 2,
			height: 2,
			bounds: BOUNDS,
			values: Float32Array.from([0, 10, 20, Number.NaN]),
		};
		expect(sampleGrid(g, 0.25, 0.25)).toBe(0);
		expect(sampleGrid(g, 0.5, 0.25)).toBe(5);
		expect(sampleGrid(g, 0.75, 0.75)).toBeNull();
		expect(sampleGrid(g, 1.2, 0.5)).toBeNull();
		const nw = { lon: -83.5 + 17 / 4, lat: 0 };
		expect(
			sampleGridLonLat(
				{ ...g, values: Float32Array.from([1, 1, 1, 1]) },
				nw.lon,
				nw.lat,
			),
		).toBe(1);
	});
});
