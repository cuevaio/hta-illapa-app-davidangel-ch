import { describe, expect, it } from "vitest";
import { CpuSolver } from "../src/solver/cpu/CpuSolver";
import {
	DEFAULT_MATERIAL,
	hydrographVolume,
	triangularHydrograph,
} from "../src/solver/params";
import type { MaterialParams } from "../src/solver/Solver";

const N = 32;
const DX = 10;

function grid(fn: (x: number, z: number) => number): Float32Array {
	const a = new Float32Array(N * N);
	for (let j = 0; j < N; j++)
		for (let i = 0; i < N; i++)
			a[j * N + i] = fn((i + 0.5) * DX, (j + 0.5) * DX);
	return a;
}

const bumpy = grid(
	(x, z) => 5 * Math.sin(x / 40) * Math.cos(z / 55) + 0.02 * x,
);
const inviscid: MaterialParams = { ...DEFAULT_MATERIAL, mu: 0, xi: 1e12 };

describe("CpuSolver", () => {
	it("preserves a lake at rest over bumpy terrain (well-balanced)", () => {
		const s = new CpuSolver(N, DX, bumpy);
		s.setMaterial(inviscid);
		const level = 3;
		const h = Float32Array.from(bumpy, (z) => Math.max(0, level - z));
		s.loadState({
			h,
			hu: new Float32Array(N * N),
			hv: new Float32Array(N * N),
		});
		s.advance(60, 10_000);
		const out = s.stateSync();
		let maxDev = 0;
		let maxMomentum = 0;
		for (let k = 0; k < h.length; k++) {
			maxDev = Math.max(maxDev, Math.abs(out.h[k] - h[k]));
			maxMomentum = Math.max(
				maxMomentum,
				Math.abs(out.hu[k]),
				Math.abs(out.hv[k]),
			);
		}
		expect(maxDev).toBeLessThan(1e-5);
		expect(maxMomentum).toBeLessThan(1e-5);
	});

	it("conserves mass, keeps h >= 0 and moves the flow downhill", () => {
		const slope = grid((x) => 100 - 0.3 * x);
		const s = new CpuSolver(N, DX, slope);
		s.setMaterial(inviscid);
		const h = grid((x, z) => (Math.hypot(x - 60, z - 160) < 40 ? 2 : 0));
		s.loadState({
			h,
			hu: new Float32Array(N * N),
			hv: new Float32Array(N * N),
		});
		const v0 = s.statsSync().volume;
		const centroidX = () => {
			const st = s.stateSync();
			let m = 0;
			let mx = 0;
			for (let k = 0; k < st.h.length; k++) {
				m += st.h[k];
				mx += st.h[k] * ((k % N) + 0.5) * DX;
			}
			return mx / m;
		};
		const x0 = centroidX();
		s.advance(20, 100_000);
		const st = s.statsSync();
		expect(Math.abs(st.volume - v0) / v0).toBeLessThan(1e-10);
		expect(st.minDepth).toBeGreaterThanOrEqual(0);
		expect(centroidX()).toBeGreaterThan(x0 + 20);
	});

	it("accelerates a thin layer down a steep slope at about g * slope (h << dz per cell)", () => {
		// Slope 0.5: 5 m drop per 10 m cell, layer 0.3 m thick. Audusse's HR underestimates this force ~30x.
		const steep = grid((x) => 400 - 0.5 * x);
		const s = new CpuSolver(N, DX, steep);
		s.setMaterial(inviscid);
		const h = grid((x, z) =>
			x > 40 && x < 200 && z > 60 && z < 260 ? 0.3 : 0,
		);
		s.loadState({
			h,
			hu: new Float32Array(N * N),
			hv: new Float32Array(N * N),
		});
		s.advance(1, 10_000);
		const st = s.stateSync();
		// Mean downslope velocity over the wet interior after 1 s.
		let m = 0;
		let hsum = 0;
		for (let k = 0; k < st.h.length; k++) {
			m += st.hu[k];
			hsum += st.h[k];
		}
		expect(m / hsum).toBeGreaterThan(0.8 * 9.81 * 0.5);
		expect(m / hsum).toBeLessThan(1.2 * 9.81 * 0.5);
	});

	it("injects exactly the hydrograph volume through the emitter", () => {
		const flat = grid(() => 0);
		const s = new CpuSolver(N, DX, flat);
		const hydrograph = triangularHydrograph(500, 10);
		s.setEmitters([
			{
				position: [160, 160],
				radius: 25,
				hydrograph,
				enabled: true,
				startTime: 0,
			},
		]);
		s.advance(hydrograph[hydrograph.length - 1].t + 10, 100_000);
		const st = s.statsSync();
		// Discharge is sampled at the start of each step, so the integral is first-order accurate.
		expect(st.injectedVolume).toBeCloseTo(hydrographVolume(hydrograph), -1);
		expect(
			Math.abs(st.volume - st.injectedVolume) / st.injectedVolume,
		).toBeLessThan(1e-10);
	});

	it("several emitters inject the sum of their hydrographs, each from its own start time", () => {
		const s = new CpuSolver(
			N,
			DX,
			grid(() => 0),
		);
		const h1 = triangularHydrograph(300, 30); // lasts 2·V/peak = 20 s
		const h2 = triangularHydrograph(200, 8);
		s.setEmitters([
			{
				position: [100, 100],
				radius: 25,
				hydrograph: h1,
				enabled: true,
				startTime: 0,
			},
			{
				position: [220, 220],
				radius: 25,
				hydrograph: h2,
				enabled: true,
				startTime: 50,
			},
		]);
		s.advance(49, 100_000);
		// Only the first one has started.
		expect(s.statsSync().injectedVolume).toBeCloseTo(hydrographVolume(h1), -1);
		s.advance(50 + h2[h2.length - 1].t + 10 - 49, 100_000);
		const st = s.statsSync();
		expect(st.injectedVolume).toBeCloseTo(
			hydrographVolume(h1) + hydrographVolume(h2),
			-1,
		);
		expect(
			Math.abs(st.volume - st.injectedVolume) / st.injectedVolume,
		).toBeLessThan(1e-10);
		// The second source deposited around its own position.
		const k2 = Math.floor(220 / DX) * N + Math.floor(220 / DX);
		expect(s.depth[k2]).toBeGreaterThan(0);
	});

	it("a disabled emitter injects nothing", () => {
		const s = new CpuSolver(
			N,
			DX,
			grid(() => 0),
		);
		s.setEmitters([
			{
				position: [160, 160],
				radius: 25,
				hydrograph: triangularHydrograph(100, 5),
				enabled: false,
				startTime: 0,
			},
		]);
		s.advance(60, 100_000);
		expect(s.statsSync().injectedVolume).toBe(0);
	});

	it("Coulomb friction holds material on a slope flatter than atan(mu)", () => {
		const gentle = grid((x) => 50 - 0.05 * x);
		const s = new CpuSolver(N, DX, gentle);
		s.setMaterial({ ...DEFAULT_MATERIAL, mu: 0.2 });
		const h = grid((x, z) =>
			Math.abs(x - 160) < 30 && Math.abs(z - 160) < 30 ? 0.05 : 0,
		);
		s.loadState({
			h,
			hu: new Float32Array(N * N),
			hv: new Float32Array(N * N),
		});
		s.advance(30, 100_000);
		expect(s.statsSync().maxSpeed).toBe(0);
	});

	it("a yield stress stops a Bingham flow that Voellmy without friction would keep moving", () => {
		const slope = grid((x) => 100 - 0.1 * x);
		const h = grid((x, z) =>
			Math.abs(x - 80) < 20 && Math.abs(z - 160) < 20 ? 0.5 : 0,
		);
		const run = (m: MaterialParams) => {
			const s = new CpuSolver(N, DX, slope);
			s.setMaterial(m);
			s.loadState({
				h,
				hu: new Float32Array(N * N),
				hv: new Float32Array(N * N),
			});
			s.advance(60, 100_000);
			return s.statsSync().maxSpeed;
		};
		expect(run(inviscid)).toBeGreaterThan(0.5);
		expect(
			run({
				...DEFAULT_MATERIAL,
				rheology: "bingham",
				yieldStress: 5000,
				viscosity: 100,
				density: 2000,
			}),
		).toBe(0);
	});

	it("reset clears the flow but keeps the terrain", () => {
		const s = new CpuSolver(N, DX, bumpy);
		s.setEmitters([
			{
				position: [160, 160],
				radius: 25,
				hydrograph: triangularHydrograph(100, 5),
				enabled: true,
				startTime: 0,
			},
		]);
		s.advance(10, 1000);
		s.reset();
		const st = s.statsSync();
		expect(st).toMatchObject({
			volume: 0,
			simTime: 0,
			injectedVolume: 0,
			steps: 0,
		});
		expect(Float32Array.from(s.terrain)).toEqual(bumpy);
	});
});

describe("resampleState", () => {
	it("preserves total volume across resolutions", async () => {
		const { resampleState } = await import("../src/solver/resample");
		const n = 32;
		const h = new Float32Array(n * n).map((_, k) =>
			k % n > 10 && k % n < 20 ? 1.5 : 0,
		);
		const zero = new Float32Array(n * n);
		const out = resampleState(
			{ h, hu: zero, hv: zero },
			n,
			48,
			10,
			(10 * n) / 48,
		);
		const v = (a: Float32Array, cell: number) =>
			a.reduce((s, x) => s + x, 0) * cell * cell;
		expect(v(out.h, (10 * n) / 48)).toBeCloseTo(v(h, 10), 3);
		expect(Math.min(...out.h)).toBeGreaterThanOrEqual(0);
	});
});

describe("CpuSolver clock carry-over", () => {
	it("setClock carries the volume removed by edits across a rebuild", () => {
		const s = new CpuSolver(8, 10, new Float32Array(64));
		s.setClock(12, 3000, 250);
		const st = s.statsSync();
		expect(st.simTime).toBe(12);
		expect(st.injectedVolume).toBe(3000);
		expect(st.editRemovedVolume).toBe(250);
	});
});
