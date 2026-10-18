import { describe, expect, it } from "vitest";
import { CpuSolver } from "../src/solver/cpu/CpuSolver";
import { DEFAULT_MATERIAL } from "../src/solver/params";
import type { MaterialParams } from "../src/solver/Solver";

const G = 9.81;
const inviscid: MaterialParams = { ...DEFAULT_MATERIAL, mu: 0, xi: 1e12 };

/** Ritter (1892): dam break over a dry, flat, frictionless bed. */
function ritterDepth(x: number, t: number, h0: number, x0: number): number {
	const c0 = Math.sqrt(G * h0);
	const xi = (x - x0) / t;
	if (xi <= -c0) return h0;
	if (xi >= 2 * c0) return 0;
	return (2 * c0 - xi) ** 2 / (9 * G);
}

/** Runs a 1D dam break along x on an n × n flat grid; returns the relative L1 error of h along the middle row. */
function damBreakError(n: number, length: number, t: number) {
	const dx = length / n;
	const h0 = 1;
	const x0 = 0.4 * length;
	const s = new CpuSolver(n, dx, new Float32Array(n * n));
	s.setMaterial(inviscid);
	const h = new Float32Array(n * n);
	for (let j = 0; j < n; j++)
		for (let i = 0; i < n; i++) if ((i + 0.5) * dx < x0) h[j * n + i] = h0;
	s.loadState({ h, hu: new Float32Array(n * n), hv: new Float32Array(n * n) });
	s.advance(t, 1_000_000);
	const out = s.stateSync();
	const row = Math.floor(n / 2) * n;
	let err = 0;
	let ref = 0;
	let maxTransverse = 0;
	for (let i = 0; i < n; i++) {
		const exact = ritterDepth((i + 0.5) * dx, t, h0, x0);
		err += Math.abs(out.h[row + i] - exact);
		ref += exact;
		// The solution must stay one-dimensional: every row equal to the middle one.
		for (let j = 0; j < n; j++)
			maxTransverse = Math.max(
				maxTransverse,
				Math.abs(out.h[j * n + i] - out.h[row + i]),
			);
	}
	return { rel: err / ref, maxTransverse, simTime: s.statsSync().simTime };
}

// 200² CPU runs take a few seconds; keep a margin above the 5 s default on a loaded machine.
describe("1D dam break (Ritter analytical solution)", {
	timeout: 30_000,
}, () => {
	it("matches the analytical depth profile within first-order accuracy", () => {
		// 200 m channel, h0 = 1 m, t = 10 s: the rarefaction (31 m) and the front (63 m) stay inside.
		const r = damBreakError(200, 200, 10);
		expect(r.simTime).toBeCloseTo(10, 6);
		expect(r.maxTransverse).toBeLessThan(1e-6);
		expect(r.rel).toBeLessThan(0.03);
	});

	it("converges when the grid is refined", () => {
		const coarse = damBreakError(100, 200, 10);
		const fine = damBreakError(200, 200, 10);
		expect(fine.rel).toBeLessThan(0.75 * coarse.rel);
	});
});
