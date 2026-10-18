import { activeWalls } from "../../edit/commands";
import { applyEditCpu } from "../../edit/walls";
import { decodeInlineTerrain, type Scenario } from "../../scenario/scenario";
import {
	createSyntheticRavine,
	type HeightGrid,
	resampleGrid,
	Terrain,
} from "../../scenario/terrain";
import { CpuSolver } from "../cpu/CpuSolver";
import { H_DRY } from "../params";
import type { RemoteFrame, RemoteTransport, SubmitOptions } from "./protocol";

/**
 * In-process stand-in for the remote server: runs the CPU reference solver on the submitted
 * scenario and streams frames. For tests and the `?solver=remote` demo, not for production.
 */
export class LoopbackTransport implements RemoteTransport {
	readonly submitted: Scenario[] = [];
	cancelled = 0;
	private readonly jobs = new Map<
		string,
		{ scenario: Scenario; options: SubmitOptions; cancelled: boolean }
	>();

	constructor(private readonly defaults: Partial<SubmitOptions> = {}) {}

	async submit(scenario: Scenario, options: SubmitOptions): Promise<string> {
		const id = `job-${this.submitted.length + 1}`;
		this.submitted.push(scenario);
		this.jobs.set(id, {
			scenario,
			options: { ...options, ...this.defaults },
			cancelled: false,
		});
		return id;
	}

	async cancel(jobId: string): Promise<void> {
		const job = this.jobs.get(jobId);
		if (job && !job.cancelled) {
			job.cancelled = true;
			this.cancelled++;
		}
	}

	async *frames(jobId: string): AsyncIterable<RemoteFrame> {
		const job = this.jobs.get(jobId);
		if (!job) throw new Error(`Unknown job ${jobId}`);
		const { scenario, options } = job;
		const terrain = new Terrain(scenarioGrid(scenario, options.resolution));
		applyEditCpu(
			terrain.effective,
			terrain.base,
			terrain.resolution,
			terrain.cellSize,
			{ mode: "replay", walls: activeWalls(scenario.commands) },
		);
		const solver = new CpuSolver(
			terrain.resolution,
			terrain.cellSize,
			terrain.effective,
			terrain.base,
		);
		solver.setMaterial(scenario.material);
		solver.setEmitters(
			scenario.origins.map((o) => ({
				position: o.pos,
				radius: o.radius,
				hydrograph: o.hydrograph,
				enabled: true,
				startTime: 0,
			})),
		);
		yield frameOf(solver);
		while (!job.cancelled && solver.simTime < options.duration - 1e-9) {
			// Yield to the event loop between frames, as a network stream would.
			await new Promise((r) => setTimeout(r, 0));
			if (job.cancelled) break;
			solver.advance(
				Math.min(options.frameInterval, options.duration - solver.simTime),
				1_000_000,
			);
			yield frameOf(solver);
		}
		this.jobs.delete(jobId);
	}
}

function scenarioGrid(s: Scenario, resolution: number): HeightGrid {
	if (s.terrain.kind === "synthetic")
		return createSyntheticRavine(resolution, s.terrain.size_m);
	if (s.terrain.kind === "dem-inline") {
		const g = decodeInlineTerrain(s.terrain);
		return g.resolution === resolution ? g : resampleGrid(g, resolution);
	}
	throw new Error(
		"The loopback transport cannot fetch referenced DEMs; embed the DEM inline",
	);
}

function frameOf(s: CpuSolver): RemoteFrame {
	const n = s.resolution;
	const h = Float32Array.from(s.depth);
	const u = new Float32Array(n * n);
	const v = new Float32Array(n * n);
	for (let k = 0; k < n * n; k++) {
		if (h[k] > H_DRY) {
			u[k] = s.unitDischargeX[k] / h[k];
			v[k] = s.unitDischargeZ[k] / h[k];
		}
	}
	return { simTime: s.simTime, resolution: n, h, u, v };
}
