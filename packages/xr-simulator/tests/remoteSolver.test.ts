import { describe, expect, it } from "vitest";
import type { EditCommand } from "../src/edit/commands";
import {
	buildScenario,
	encodeInlineTerrain,
	type Scenario,
} from "../src/scenario/scenario";
import { CpuSolver } from "../src/solver/cpu/CpuSolver";
import { DEFAULT_MATERIAL, triangularHydrograph } from "../src/solver/params";
import { LoopbackTransport } from "../src/solver/remote/LoopbackTransport";
import {
	decodeFrame,
	encodeFrame,
	type RemoteFrame,
} from "../src/solver/remote/protocol";
import { RemoteSolver } from "../src/solver/remote/RemoteSolver";

const N = 24;
const DX = 10;
const terrain = new Float32Array(N * N).map((_, k) => 60 - 0.25 * (k % N) * DX);
const source: EditCommand = {
	type: "source",
	id: "s1",
	pos: [40, 120],
	radius: 20,
	volume: 3000,
	peakDischarge: 60,
};

function scenario(mu = DEFAULT_MATERIAL.mu): Scenario {
	return buildScenario({
		name: "plano",
		terrain: encodeInlineTerrain({
			resolution: N,
			cellSize: DX,
			heights: terrain,
		}),
		material: { ...DEFAULT_MATERIAL, mu },
		commands: [source],
		speed: 10,
	});
}

/** Lets the transport's async frame loop run. */
const settle = async (rounds = 50) => {
	for (let k = 0; k < rounds; k++) await new Promise((r) => setTimeout(r, 0));
};

describe("remote frame protocol", () => {
	it("encodes depth and velocity rasters as one binary message and decodes them back", () => {
		const f: RemoteFrame = {
			simTime: 12.5,
			resolution: 2,
			h: Float32Array.of(1, 2, 3, 4),
			u: Float32Array.of(0.5, 0, -1, 2),
			v: Float32Array.of(0, 0, 0, 7),
		};
		const back = decodeFrame(encodeFrame(f));
		expect(back).toEqual(f);
	});
	it("rejects messages that are not frames", () => {
		expect(() => decodeFrame(new ArrayBuffer(32))).toThrow(/frame/i);
		expect(() =>
			decodeFrame(
				encodeFrame({
					simTime: 0,
					resolution: 0,
					h: new Float32Array(0),
					u: new Float32Array(0),
					v: new Float32Array(0),
				}),
			),
		).toThrow(/resolution/i);
	});
});

describe("RemoteSolver (loopback transport)", () => {
	it("is a Solver whose state follows the frames computed for the submitted scenario", async () => {
		const transport = new LoopbackTransport({ frameInterval: 2, duration: 40 });
		const s = new RemoteSolver(transport, N, DX, () => scenario());
		expect(s.kind).toBe("remote");
		s.advance(0, 1); // submits the scenario
		await settle();
		for (let k = 0; k < 10; k++) s.advance(1, 1);
		await settle();
		const st = await s.readStats();
		expect(st.simTime).toBe(10);
		// Same scenario run directly on the CPU solver up to the same time.
		const ref = new CpuSolver(N, DX, terrain);
		ref.setMaterial(DEFAULT_MATERIAL);
		ref.setEmitters([
			{
				position: source.pos,
				radius: source.radius,
				hydrograph: triangularHydrograph(source.volume, source.peakDischarge),
				enabled: true,
				startTime: 0,
			},
		]);
		for (let t = 0; t < 10; t += 2) ref.advance(2, 1_000_000);
		const a = await s.readState();
		const b = ref.stateSync();
		let worst = 0;
		for (let k = 0; k < N * N; k++)
			worst = Math.max(
				worst,
				Math.abs(a.h[k] - b.h[k]),
				Math.abs(a.hu[k] - b.hu[k]),
			);
		expect(worst).toBeLessThan(1e-4);
		expect(st.volume).toBeCloseTo(ref.statsSync().volume, 0);
		expect(st.injectedVolume).toBeCloseTo(ref.statsSync().injectedVolume, -1);
		s.dispose();
	});

	it("falls behind instead of skipping when frames have not arrived", async () => {
		const s = new RemoteSolver(
			new LoopbackTransport({ frameInterval: 2, duration: 40 }),
			N,
			DX,
			() => scenario(),
		);
		s.advance(100, 1); // nothing received yet
		expect((await s.readStats()).simTime).toBe(0);
		s.dispose();
	});

	it("resubmits a fresh scenario when the setup changes and restarts at t = 0", async () => {
		let mu = DEFAULT_MATERIAL.mu;
		// Long enough that the first job is still streaming when the setup changes.
		const transport = new LoopbackTransport({
			frameInterval: 2,
			duration: 600,
		});
		const s = new RemoteSolver(transport, N, DX, () => scenario(mu));
		s.advance(0, 1);
		await settle();
		s.advance(6, 1);
		expect((await s.readStats()).simTime).toBe(6);
		mu = 0.3;
		s.setMaterial({ ...DEFAULT_MATERIAL, mu });
		s.advance(0, 1);
		expect((await s.readStats()).simTime).toBe(0);
		expect(transport.submitted.map((sc) => sc.material.mu)).toEqual([
			DEFAULT_MATERIAL.mu,
			0.3,
		]);
		expect(transport.cancelled).toBe(1);
		s.dispose();
	});

	it("reset replays the received frames from t = 0 without recomputing", async () => {
		const transport = new LoopbackTransport({ frameInterval: 2, duration: 40 });
		const s = new RemoteSolver(transport, N, DX, () => scenario());
		s.advance(0, 1);
		await settle();
		s.advance(8, 1);
		s.reset();
		expect((await s.readStats()).simTime).toBe(0);
		s.advance(4, 1);
		expect((await s.readStats()).simTime).toBe(4);
		expect(transport.submitted).toHaveLength(1);
		s.dispose();
	});
});
