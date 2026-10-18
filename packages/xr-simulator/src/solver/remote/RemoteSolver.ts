import type { EditBatch } from "../../edit/walls";
import type { Scenario } from "../../scenario/scenario";
import { H_DRY } from "../params";
import { resampleState } from "../resample";
import type {
	EmitterParams,
	FlowState,
	HydrographPoint,
	MaterialParams,
	Solver,
	SolverStats,
} from "../Solver";
import type { RemoteFrame, RemoteTransport, SubmitOptions } from "./protocol";

/**
 * Skeleton remote backend: sends the scenario to a server and shows the frames it streams back.
 * Any setup change (material, origins, terrain edits) resubmits the current scenario, so the remote
 * run restarts at t = 0. `advance` moves a playhead over the received frames and falls behind
 * rather than skipping when they have not arrived yet. Frames on another grid are resampled.
 */
export class RemoteSolver implements Solver {
	readonly kind = "remote" as const;
	private frames: RemoteFrame[] = [];
	private jobId: string | null = null;
	private generation = 0;
	private dirty = true;
	private playhead = 0;
	private shown: { frame: RemoteFrame; state: FlowState } | null = null;
	private terrainHeights: Float32Array;
	private hydrographs: HydrographPoint[][] = [];
	private readonly options: SubmitOptions;
	/** Last transport error, for the UI. */
	error: string | null = null;

	constructor(
		private readonly transport: RemoteTransport,
		readonly resolution: number,
		readonly cellSize: number,
		private readonly scenario: () => Scenario,
		options: Partial<SubmitOptions> & { terrain?: Float32Array } = {},
	) {
		this.options = { resolution, frameInterval: 1, duration: 600, ...options };
		this.terrainHeights =
			options.terrain ?? new Float32Array(resolution * resolution);
	}

	setMaterial(_params: MaterialParams): void {
		this.dirty = true;
	}
	setEmitters(_emitters: EmitterParams[]): void {
		this.dirty = true;
	}
	setTerrain(effective: Float32Array): void {
		this.terrainHeights = effective;
		this.dirty = true;
	}
	applyEdit(_batch: EditBatch): void {
		this.dirty = true;
	}

	advance(simSeconds: number, _maxSubsteps: number): void {
		if (this.dirty) this.restart();
		const last = this.frames.length
			? this.frames[this.frames.length - 1].simTime
			: 0;
		this.playhead = Math.min(this.playhead + simSeconds, last);
	}

	reset(): void {
		this.playhead = 0;
	}

	async readStats(): Promise<SolverStats> {
		const cur = this.current();
		const dx2 = this.cellSize * this.cellSize;
		let volume = 0;
		let maxDepth = 0;
		let maxSpeed = 0;
		let minDepth = cur ? Number.POSITIVE_INFINITY : 0;
		let wetCells = 0;
		if (cur) {
			const { h, hu, hv } = cur.state;
			for (let k = 0; k < h.length; k++) {
				volume += h[k];
				maxDepth = Math.max(maxDepth, h[k]);
				minDepth = Math.min(minDepth, h[k]);
				if (h[k] > H_DRY) {
					wetCells++;
					maxSpeed = Math.max(maxSpeed, Math.hypot(hu[k], hv[k]) / h[k]);
				}
			}
		}
		const t = cur?.frame.simTime ?? 0;
		return {
			simTime: t,
			dt: 0,
			steps: cur ? this.frames.indexOf(cur.frame) : 0,
			volume: volume * dx2,
			injectedVolume: this.hydrographs.reduce(
				(a, p) => a + injectedUntil(p, t),
				0,
			),
			editRemovedVolume: 0,
			maxDepth,
			maxSpeed,
			minDepth,
			wetCells,
		};
	}

	async readState(): Promise<FlowState> {
		const cur = this.current();
		const cells = this.resolution * this.resolution;
		if (!cur)
			return {
				h: new Float32Array(cells),
				hu: new Float32Array(cells),
				hv: new Float32Array(cells),
			};
		return {
			h: cur.state.h.slice(),
			hu: cur.state.hu.slice(),
			hv: cur.state.hv.slice(),
		};
	}

	/** The state comes from the server; a local state cannot be pushed to it. */
	loadState(_state: FlowState): void {}

	setClock(simTime: number, _injected: number, _removed: number): void {
		this.playhead = simTime;
	}

	/** Views for the CPU surface path (same shape as CpuSolver's). */
	get depth(): Float32Array {
		return (
			this.current()?.state.h ??
			new Float32Array(this.resolution * this.resolution)
		);
	}
	get unitDischargeX(): Float32Array {
		return (
			this.current()?.state.hu ??
			new Float32Array(this.resolution * this.resolution)
		);
	}
	get unitDischargeZ(): Float32Array {
		return (
			this.current()?.state.hv ??
			new Float32Array(this.resolution * this.resolution)
		);
	}
	get terrain(): Float32Array {
		return this.terrainHeights;
	}

	dispose(): void {
		this.generation++;
		if (this.jobId) void this.transport.cancel(this.jobId);
		this.jobId = null;
	}

	private restart(): void {
		this.dirty = false;
		if (this.jobId) void this.transport.cancel(this.jobId);
		this.jobId = null;
		this.frames = [];
		this.shown = null;
		this.playhead = 0;
		this.error = null;
		const gen = ++this.generation;
		const scenario = this.scenario();
		this.hydrographs = scenario.origins.map((o) => o.hydrograph);
		void (async () => {
			try {
				const id = await this.transport.submit(scenario, this.options);
				if (gen !== this.generation) return void this.transport.cancel(id);
				this.jobId = id;
				for await (const frame of this.transport.frames(id)) {
					if (gen !== this.generation) return;
					this.frames.push(frame);
				}
			} catch (err) {
				if (gen === this.generation)
					this.error = err instanceof Error ? err.message : String(err);
			}
		})();
	}

	/** Latest received frame at or before the playhead, converted to the client grid. */
	private current(): { frame: RemoteFrame; state: FlowState } | null {
		let frame: RemoteFrame | null = null;
		for (const f of this.frames) {
			if (f.simTime <= this.playhead + 1e-9) frame = f;
			else break;
		}
		if (!frame) return null;
		if (this.shown?.frame !== frame)
			this.shown = { frame, state: this.toState(frame) };
		return this.shown;
	}

	private toState(f: RemoteFrame): FlowState {
		const cells = f.resolution * f.resolution;
		const hu = new Float32Array(cells);
		const hv = new Float32Array(cells);
		for (let k = 0; k < cells; k++) {
			hu[k] = f.h[k] * f.u[k];
			hv[k] = f.h[k] * f.v[k];
		}
		const state = { h: f.h, hu, hv };
		if (f.resolution === this.resolution) return state;
		const size = this.resolution * this.cellSize;
		return resampleState(
			state,
			f.resolution,
			this.resolution,
			size / f.resolution,
			this.cellSize,
		);
	}
}

/** Volume released by a hydrograph up to time t (trapezoidal over its linear pieces). */
export function injectedUntil(points: HydrographPoint[], t: number): number {
	let v = 0;
	for (let k = 1; k < points.length; k++) {
		const a = points[k - 1];
		const b = points[k];
		if (t <= a.t) break;
		const end = Math.min(t, b.t);
		const qEnd = a.q + ((end - a.t) / (b.t - a.t || 1)) * (b.q - a.q);
		v += 0.5 * (a.q + qEnd) * (end - a.t);
	}
	return v;
}
