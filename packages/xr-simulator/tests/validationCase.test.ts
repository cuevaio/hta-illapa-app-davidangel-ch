import { describe, expect, it } from "vitest";
import {
	parseEsriAscii,
	runReference,
	toEsriAscii,
} from "../src/scenario/validationCase";
import { DEFAULT_MATERIAL, triangularHydrograph } from "../src/solver/params";

describe("ESRI ASCII grid", () => {
	it("writes the header and puts the northernmost row (largest z) first", () => {
		// 2 × 2 grid, index = j·n + i, z grows with j.
		const text = toEsriAscii(Float32Array.from([1, 2, 3, Number.NaN]), 2, 10);
		const lines = text.trim().split("\n");
		expect(lines.slice(0, 6)).toEqual([
			"ncols 2",
			"nrows 2",
			"xllcorner 0",
			"yllcorner 0",
			"cellsize 10",
			"NODATA_value -9999",
		]);
		expect(lines[6].trim()).toBe("3 -9999");
		expect(lines[7].trim()).toBe("1 2");
	});

	it("round-trips through the parser", () => {
		const values = Float32Array.from([
			0.5,
			1.25,
			-3,
			Number.NaN,
			7,
			8,
			9,
			10,
			11,
		]);
		const g = parseEsriAscii(toEsriAscii(values, 3, 2.5));
		expect(g).toMatchObject({ n: 3, cellSize: 2.5 });
		expect(Array.from(g.values)).toEqual(Array.from(values));
	});
});

describe("runReference", () => {
	it("records maximum depth and first arrival time; cells never reached have no arrival", () => {
		const n = 32;
		const dx = 10;
		// Plane sloping down along +x, inflow near the upper edge.
		const terrain = new Float32Array(n * n).map(
			(_, k) => 100 - 0.2 * (k % n) * dx,
		);
		const r = runReference({
			n,
			cellSize: dx,
			terrain,
			material: DEFAULT_MATERIAL,
			emitter: {
				position: [50, 160],
				radius: 25,
				hydrograph: triangularHydrograph(2000, 50),
			},
			duration: 120,
			sampleInterval: 0.5,
			threshold: 0.05,
		});
		const at = (x: number, z: number) =>
			Math.floor(z / dx) * n + Math.floor(x / dx);
		expect(r.arrival[at(50, 160)]).toBeLessThan(20); // the hydrograph ramps up over ~27 s
		expect(r.hmax[at(50, 160)]).toBeGreaterThan(0.05);
		// Upslope corner is never reached.
		expect(Number.isNaN(r.arrival[at(5, 5)])).toBe(true);
		// Arrival grows downstream along the flow path.
		expect(r.arrival[at(150, 160)]).toBeGreaterThan(r.arrival[at(50, 160)]);
		// Wherever there is an arrival, hmax reached the threshold.
		for (let k = 0; k < n * n; k++)
			if (!Number.isNaN(r.arrival[k]))
				expect(r.hmax[k]).toBeGreaterThanOrEqual(0.05);
		expect(r.massError).toBeLessThan(1e-6);
	});
});
