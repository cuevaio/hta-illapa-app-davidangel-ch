import { applyEditCpu, displacedDepth, type EditBatch } from "../../edit/walls";
import {
	createFaceFluxes,
	type FrictionCoefficients,
	faceFlux,
	frictionCoefficients,
	frictionScale,
	velocity,
} from "../numerics";
import {
	CFL,
	DEFAULT_MATERIAL,
	DT_MAX,
	dischargeAt,
	GRAVITY,
	H_DRY,
	MAX_EMITTERS,
} from "../params";
import type {
	EmitterParams,
	FlowState,
	MaterialParams,
	Solver,
	SolverStats,
} from "../Solver";

/**
 * Reference solver in double precision. Same scheme as the WGSL solver; used
 * to validate it, in unit tests, and as the plan-B backend without WebGPU.
 * Domain boundaries are reflective walls.
 */
export class CpuSolver implements Solver {
	readonly kind = "cpu-reference" as const;
	readonly resolution: number;
	readonly cellSize: number;

	private h: Float64Array;
	private hu: Float64Array;
	private hv: Float64Array;
	private nh: Float64Array;
	private nhu: Float64Array;
	private nhv: Float64Array;
	private z: Float64Array;
	/** f32 copies used by the shared edit routine, so CPU edits match GPU edits. */
	private readonly base32: Float32Array;
	private readonly z32: Float32Array;
	private removed = 0;
	private friction: FrictionCoefficients =
		frictionCoefficients(DEFAULT_MATERIAL);
	private emitters: { params: EmitterParams; cells: Uint32Array }[] = [];
	private t = 0;
	private injected = 0;
	private steps = 0;
	private lastDt = 0;
	private readonly fx = createFaceFluxes();

	constructor(
		resolution: number,
		cellSize: number,
		terrain: Float32Array,
		base: Float32Array = terrain,
	) {
		this.resolution = resolution;
		this.cellSize = cellSize;
		const cells = resolution * resolution;
		this.h = new Float64Array(cells);
		this.hu = new Float64Array(cells);
		this.hv = new Float64Array(cells);
		this.nh = new Float64Array(cells);
		this.nhu = new Float64Array(cells);
		this.nhv = new Float64Array(cells);
		this.z = new Float64Array(cells);
		this.base32 = Float32Array.from(base);
		this.z32 = new Float32Array(cells);
		this.setTerrain(terrain);
	}

	setMaterial(params: MaterialParams): void {
		this.friction = frictionCoefficients(params);
	}

	setEmitters(emitters: EmitterParams[]): void {
		if (emitters.length > MAX_EMITTERS)
			throw new Error(`Máximo ${MAX_EMITTERS} orígenes`);
		const n = this.resolution;
		const dx = this.cellSize;
		this.emitters = emitters.map((emitter) => {
			const cells: number[] = [];
			for (let j = 0; j < n; j++) {
				for (let i = 0; i < n; i++) {
					const ddx = (i + 0.5) * dx - emitter.position[0];
					const ddz = (j + 0.5) * dx - emitter.position[1];
					if (ddx * ddx + ddz * ddz <= emitter.radius * emitter.radius)
						cells.push(j * n + i);
				}
			}
			return { params: emitter, cells: Uint32Array.from(cells) };
		});
	}

	setTerrain(effective: Float32Array): void {
		if (effective.length !== this.z.length)
			throw new Error("Terrain size does not match solver resolution");
		this.z32.set(effective);
		this.z.set(effective);
	}

	applyEdit(batch: EditBatch): void {
		const n = this.resolution;
		const old = Float32Array.from(this.z32);
		const region = applyEditCpu(this.z32, this.base32, n, this.cellSize, batch);
		if (!region) return;
		for (let j = region.j0; j <= region.j1; j++) {
			for (let i = region.i0; i <= region.i1; i++) {
				const k = j * n + i;
				this.z[k] = this.z32[k];
				const h = this.h[k];
				const r = displacedDepth(h, this.z32[k] - old[k]);
				if (r <= 0) continue;
				const f = (h - r) / h;
				this.h[k] = h - r;
				this.hu[k] *= f;
				this.hv[k] *= f;
				this.removed += r * this.cellSize * this.cellSize;
			}
		}
	}

	reset(): void {
		this.h.fill(0);
		this.hu.fill(0);
		this.hv.fill(0);
		this.t = this.injected = this.lastDt = this.removed = 0;
		this.steps = 0;
	}

	/** Largest stable step for the current state (s). */
	stableDt(): number {
		let smax = 0;
		for (let k = 0; k < this.h.length; k++) {
			const h = this.h[k];
			if (h <= H_DRY) continue;
			const c = Math.sqrt(GRAVITY * h);
			const s = Math.abs(this.hu[k] / h) + Math.abs(this.hv[k] / h) + 2 * c;
			if (s > smax) smax = s;
		}
		return smax > 0 ? Math.min((CFL * this.cellSize) / smax, DT_MAX) : DT_MAX;
	}

	advance(simSeconds: number, maxSubsteps: number): void {
		let remaining = simSeconds;
		for (let k = 0; k < maxSubsteps && remaining > 1e-9; k++) {
			const dt = Math.min(this.stableDt(), remaining);
			this.step(dt);
			remaining -= dt;
		}
	}

	/** One explicit step of size dt (caller guarantees dt ≤ stableDt()). */
	step(dt: number): void {
		const n = this.resolution;
		const { h, hu, hv, z, fx } = this;
		const r = dt / this.cellSize;
		for (let j = 0; j < n; j++) {
			for (let i = 0; i < n; i++) {
				const k = j * n + i;
				const hc = h[k];
				const uc = velocity(hc, hu[k]);
				const vc = velocity(hc, hv[k]);
				const zc = z[k];
				let dh = 0;
				let dmx = 0;
				let dmy = 0;

				// East face: this cell is the left state; a wall mirrors it.
				if (i + 1 < n) {
					const e = k + 1;
					faceFlux(
						hc,
						uc,
						vc,
						zc,
						h[e],
						velocity(h[e], hu[e]),
						velocity(h[e], hv[e]),
						z[e],
						fx,
					);
				} else faceFlux(hc, uc, vc, zc, hc, -uc, vc, zc, fx);
				dh -= fx.left.h;
				dmx -= fx.left.n;
				dmy -= fx.left.t;

				// West face: this cell is the right state.
				if (i > 0) {
					const w = k - 1;
					faceFlux(
						h[w],
						velocity(h[w], hu[w]),
						velocity(h[w], hv[w]),
						z[w],
						hc,
						uc,
						vc,
						zc,
						fx,
					);
				} else faceFlux(hc, -uc, vc, zc, hc, uc, vc, zc, fx);
				dh += fx.right.h;
				dmx += fx.right.n;
				dmy += fx.right.t;

				// North face (j + 1/2): normal velocity is v, tangential is u.
				if (j + 1 < n) {
					const s = k + n;
					faceFlux(
						hc,
						vc,
						uc,
						zc,
						h[s],
						velocity(h[s], hv[s]),
						velocity(h[s], hu[s]),
						z[s],
						fx,
					);
				} else faceFlux(hc, vc, uc, zc, hc, -vc, uc, zc, fx);
				dh -= fx.left.h;
				dmy -= fx.left.n;
				dmx -= fx.left.t;

				// South face (j - 1/2).
				if (j > 0) {
					const s = k - n;
					faceFlux(
						h[s],
						velocity(h[s], hv[s]),
						velocity(h[s], hu[s]),
						z[s],
						hc,
						vc,
						uc,
						zc,
						fx,
					);
				} else faceFlux(hc, -vc, uc, zc, hc, vc, uc, zc, fx);
				dh += fx.right.h;
				dmy += fx.right.n;
				dmx += fx.right.t;

				this.nh[k] = Math.max(0, hc + r * dh);
				this.nhu[k] = hu[k] + r * dmx;
				this.nhv[k] = hv[k] + r * dmy;
			}
		}

		// Emitters: each one spreads its discharge evenly over the cells inside its radius.
		for (const { params, cells } of this.emitters) {
			const q = params.enabled
				? dischargeAt(params.hydrograph, this.t - params.startTime)
				: 0;
			if (q <= 0 || cells.length === 0) continue;
			const dhSource =
				(q * dt) / (cells.length * this.cellSize * this.cellSize);
			for (const k of cells) this.nh[k] += dhSource;
			this.injected += q * dt;
		}

		for (let k = 0; k < this.nh.length; k++) {
			const hk = this.nh[k];
			if (hk < H_DRY) {
				this.nhu[k] = this.nhv[k] = 0;
				continue;
			}
			const f = frictionScale(
				hk,
				Math.hypot(this.nhu[k], this.nhv[k]),
				dt,
				this.friction,
			);
			this.nhu[k] *= f;
			this.nhv[k] *= f;
		}

		[this.h, this.nh] = [this.nh, this.h];
		[this.hu, this.nhu] = [this.nhu, this.hu];
		[this.hv, this.nhv] = [this.nhv, this.hv];
		this.t += dt;
		this.lastDt = dt;
		this.steps++;
	}

	statsSync(): SolverStats {
		let volume = 0;
		let maxDepth = 0;
		let maxSpeed = 0;
		let minDepth = Number.POSITIVE_INFINITY;
		let wetCells = 0;
		for (let k = 0; k < this.h.length; k++) {
			const h = this.h[k];
			volume += h;
			if (h < minDepth) minDepth = h;
			if (h > maxDepth) maxDepth = h;
			if (h > H_DRY) {
				wetCells++;
				const s = Math.hypot(this.hu[k], this.hv[k]) / h;
				if (s > maxSpeed) maxSpeed = s;
			}
		}
		return {
			simTime: this.t,
			dt: this.lastDt,
			steps: this.steps,
			volume: volume * this.cellSize * this.cellSize,
			injectedVolume: this.injected,
			editRemovedVolume: this.removed,
			maxDepth,
			maxSpeed,
			minDepth,
			wetCells,
		};
	}

	async readStats(): Promise<SolverStats> {
		return this.statsSync();
	}

	stateSync(): FlowState {
		return {
			h: Float32Array.from(this.h),
			hu: Float32Array.from(this.hu),
			hv: Float32Array.from(this.hv),
		};
	}

	async readState(): Promise<FlowState> {
		return this.stateSync();
	}

	loadState(state: FlowState): void {
		this.h.set(state.h);
		this.hu.set(state.hu);
		this.hv.set(state.hv);
	}

	setClock(
		simTime: number,
		injectedVolume: number,
		editRemovedVolume: number,
	): void {
		this.t = simTime;
		this.injected = injectedVolume;
		this.removed = editRemovedVolume;
	}

	/** Current simulation time (s), read synchronously. */
	get simTime(): number {
		return this.t;
	}

	/** Direct read access for the CPU render path (no copies). */
	get depth(): Float64Array {
		return this.h;
	}
	get unitDischargeX(): Float64Array {
		return this.hu;
	}
	get unitDischargeZ(): Float64Array {
		return this.hv;
	}
	get terrain(): Float64Array {
		return this.z;
	}

	dispose(): void {}
}
