import type { DataBuffer } from "@babylonjs/core/Buffers/dataBuffer";
import { StorageBuffer } from "@babylonjs/core/Buffers/storageBuffer";
import { ComputeShader } from "@babylonjs/core/Compute/computeShader";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import "@babylonjs/core/Engines/WebGPU/Extensions/engine.computeShader";
import {
	type CellRegion,
	type EditBatch,
	MAX_WALL_SEGMENTS,
	MAX_WALLS,
	packWalls,
	unionRegion,
	WALL_FLOATS,
	wallRegion,
} from "../../edit/walls";
import { frictionCoefficients } from "../numerics";
import {
	CFL,
	DEFAULT_MATERIAL,
	DT_MAX,
	GRAVITY,
	H_DRY,
	MAX_EMITTERS,
	MAX_HYDROGRAPH_POINTS,
} from "../params";
import type {
	EmitterParams,
	FlowState,
	MaterialParams,
	Solver,
	SolverStats,
} from "../Solver";
import {
	BEGIN_FRAME_WGSL,
	CLEAR_EMITTER_WGSL,
	COMPUTE_DT_WGSL,
	COUNT_EMITTER_WGSL,
	CTRL_LAYOUT,
	EDIT_REMOVED_UNIT,
	EDIT_WGSL,
	EMITTER_FLOATS,
	EMITTERS_HEADER_FLOATS,
	PARAMS_LAYOUT,
	STATS_WGSL,
	SURFACE_WGSL,
	UPDATE_WGSL,
	WORKGROUP,
} from "./shaders";

export interface SurfaceStyle {
	colorMode: "depth" | "speed";
	/** Depth (m) mapped to the top of the colour ramp. */
	depthScale: number;
	/** Speed (m/s) mapped to the top of the colour ramp. */
	speedScale: number;
}

/** GPU buffers holding the flow-surface mesh, written by the surface kernel. */
export interface SurfaceBuffers {
	positions: StorageBuffer;
	normals: StorageBuffer;
	colors: StorageBuffer;
}

const B = {
	params: { group: 0, binding: 0 },
	emitters: { group: 0, binding: 1 },
	ctrl: { group: 0, binding: 2 },
};

const STORAGE_RW =
	Constants.BUFFER_CREATIONFLAG_STORAGE |
	Constants.BUFFER_CREATIONFLAG_READ |
	Constants.BUFFER_CREATIONFLAG_WRITE;

/** Shallow-water solver running entirely on WebGPU compute; no per-frame readbacks. */
export class LocalGpuSolver implements Solver {
	readonly kind = "local-gpu" as const;
	readonly resolution: number;
	readonly cellSize: number;
	readonly surface: SurfaceBuffers;
	/** Solver steps dispatched in the last `advance` call. */
	lastSubsteps = 0;
	/** Wall-clock cost per solver step (ms) from the last timing probe, including dispatch overhead. */
	measuredStepMs: number | null = null;
	private probeRequested = false;

	private readonly engine: WebGPUEngine;
	private readonly paramsData = new Float32Array(PARAMS_LAYOUT.floats);
	private readonly paramsU32 = new Uint32Array(this.paramsData.buffer);
	private readonly emitterData = new Float32Array(
		EMITTERS_HEADER_FLOATS + MAX_EMITTERS * EMITTER_FLOATS,
	);
	private readonly emitterU32 = new Uint32Array(this.emitterData.buffer);
	private readonly paramsBuf: DataBuffer;
	private readonly emitterBuf: DataBuffer;
	private readonly ctrl: StorageBuffer;
	private readonly terrain: StorageBuffer;
	private readonly baseTerrain: StorageBuffer;
	private readonly editHeader = new Uint32Array(8);
	private readonly editHeaderBuf: DataBuffer;
	private readonly editCmds: StorageBuffer;
	private readonly editSegs: StorageBuffer;
	private lastEditFrame = -1;
	private readonly stateA: StorageBuffer;
	private readonly stateB: StorageBuffer;
	private readonly partials: StorageBuffer;
	private readonly groups: number;
	private readonly shaders: Record<
		| "begin"
		| "dt"
		| "clear"
		| "count"
		| "edit"
		| "updateAB"
		| "updateBA"
		| "stats"
		| "surface",
		ComputeShader
	>;
	/** CFL step estimate, refreshed by readStats; drives the substep count. */
	private dtEstimate = DT_MAX;
	private paramsDirty = true;

	private constructor(
		engine: WebGPUEngine,
		resolution: number,
		cellSize: number,
		base: Float32Array,
		terrain: Float32Array,
	) {
		this.engine = engine;
		this.resolution = resolution;
		this.cellSize = cellSize;
		const cells = resolution * resolution;
		this.groups = Math.ceil(resolution / WORKGROUP);

		this.writeStaticParams();
		this.setMaterialData(DEFAULT_MATERIAL);
		this.setStyle({ colorMode: "depth", depthScale: 5, speedScale: 15 });
		this.paramsBuf = engine.createUniformBuffer(
			this.paramsData,
			"solver-params",
		);
		this.emitterBuf = engine.createUniformBuffer(
			this.emitterData,
			"solver-emitter",
		);

		this.ctrl = new StorageBuffer(
			engine,
			CTRL_LAYOUT.bytes,
			STORAGE_RW,
			"solver-ctrl",
		);
		this.ctrl.update(new Uint32Array(CTRL_LAYOUT.bytes / 4));
		this.terrain = new StorageBuffer(
			engine,
			cells * 4,
			STORAGE_RW,
			"terrain-effective",
		);
		this.terrain.update(terrain);
		this.baseTerrain = new StorageBuffer(
			engine,
			cells * 4,
			STORAGE_RW,
			"terrain-base",
		);
		this.baseTerrain.update(base);
		this.editHeaderBuf = engine.createUniformBuffer(
			new Float32Array(this.editHeader.buffer),
			"edit-header",
		);
		this.editCmds = new StorageBuffer(
			engine,
			MAX_WALLS * WALL_FLOATS * 4,
			STORAGE_RW,
			"edit-cmds",
		);
		this.editSegs = new StorageBuffer(
			engine,
			MAX_WALLS * MAX_WALL_SEGMENTS * 16,
			STORAGE_RW,
			"edit-segs",
		);
		this.stateA = new StorageBuffer(engine, cells * 16, STORAGE_RW, "state-a");
		this.stateB = new StorageBuffer(engine, cells * 16, STORAGE_RW, "state-b");
		this.stateA.update(new Float32Array(cells * 4));
		this.stateB.update(new Float32Array(cells * 4));
		this.partials = new StorageBuffer(
			engine,
			this.groups * this.groups * 32,
			STORAGE_RW,
			"stats-partials",
		);

		const vertexFlags =
			Constants.BUFFER_CREATIONFLAG_STORAGE |
			Constants.BUFFER_CREATIONFLAG_VERTEX |
			Constants.BUFFER_CREATIONFLAG_WRITE;
		this.surface = {
			positions: new StorageBuffer(
				engine,
				cells * 16,
				vertexFlags,
				"surface-positions",
			),
			normals: new StorageBuffer(
				engine,
				cells * 16,
				vertexFlags,
				"surface-normals",
			),
			colors: new StorageBuffer(
				engine,
				cells * 16,
				vertexFlags,
				"surface-colors",
			),
		};

		const make = (
			name: string,
			source: string,
			extra: Record<string, number>,
			uses: (keyof typeof B)[],
		) => {
			const mapping: Record<string, { group: number; binding: number }> = {};
			for (const u of uses) mapping[u] = B[u];
			for (const [k, binding] of Object.entries(extra))
				mapping[k] = { group: 0, binding };
			const cs = new ComputeShader(
				name,
				engine,
				{ computeSource: source },
				{ bindingsMapping: mapping },
			);
			if (uses.includes("params"))
				cs.setUniformBuffer("params", this.paramsBuf);
			if (uses.includes("emitters"))
				cs.setUniformBuffer("emitters", this.emitterBuf);
			if (uses.includes("ctrl")) cs.setStorageBuffer("ctrl", this.ctrl);
			return cs;
		};
		const updateAB = make(
			"update-ab",
			UPDATE_WGSL,
			{ terrain: 3, stateIn: 4, stateOut: 5 },
			["params", "emitters", "ctrl"],
		);
		updateAB.setStorageBuffer("terrain", this.terrain);
		updateAB.setStorageBuffer("stateIn", this.stateA);
		updateAB.setStorageBuffer("stateOut", this.stateB);
		const updateBA = make(
			"update-ba",
			UPDATE_WGSL,
			{ terrain: 3, stateIn: 4, stateOut: 5 },
			["params", "emitters", "ctrl"],
		);
		updateBA.setStorageBuffer("terrain", this.terrain);
		updateBA.setStorageBuffer("stateIn", this.stateB);
		updateBA.setStorageBuffer("stateOut", this.stateA);
		const stats = make("stats", STATS_WGSL, { state: 3, partials: 4 }, [
			"params",
		]);
		stats.setStorageBuffer("state", this.stateA);
		stats.setStorageBuffer("partials", this.partials);
		const surface = make(
			"surface",
			SURFACE_WGSL,
			{ terrain: 3, state: 4, positions: 5, normals: 6, colors: 7 },
			["params"],
		);
		surface.setStorageBuffer("terrain", this.terrain);
		surface.setStorageBuffer("state", this.stateA);
		surface.setStorageBuffer("positions", this.surface.positions);
		surface.setStorageBuffer("normals", this.surface.normals);
		surface.setStorageBuffer("colors", this.surface.colors);
		const edit = make(
			"edit",
			EDIT_WGSL,
			{ terrain: 3, baseTerrain: 4, state: 5, edit: 6, cmds: 7, segs: 8 },
			["params", "ctrl"],
		);
		edit.setStorageBuffer("terrain", this.terrain);
		edit.setStorageBuffer("baseTerrain", this.baseTerrain);
		edit.setStorageBuffer("state", this.stateA);
		edit.setUniformBuffer("edit", this.editHeaderBuf);
		edit.setStorageBuffer("cmds", this.editCmds);
		edit.setStorageBuffer("segs", this.editSegs);
		this.shaders = {
			edit,
			begin: make("begin-frame", BEGIN_FRAME_WGSL, {}, ["params", "ctrl"]),
			dt: make("compute-dt", COMPUTE_DT_WGSL, {}, [
				"params",
				"emitters",
				"ctrl",
			]),
			clear: make("clear-emitter", CLEAR_EMITTER_WGSL, {}, ["ctrl"]),
			count: make("count-emitter", COUNT_EMITTER_WGSL, {}, [
				"params",
				"emitters",
				"ctrl",
			]),
			updateAB,
			updateBA,
			stats,
			surface,
		};
	}

	static async create(
		engine: WebGPUEngine,
		resolution: number,
		cellSize: number,
		base: Float32Array,
		terrain: Float32Array,
	): Promise<LocalGpuSolver> {
		const solver = new LocalGpuSolver(
			engine,
			resolution,
			cellSize,
			base,
			terrain,
		);
		await Promise.all(Object.values(solver.shaders).map((cs) => waitReady(cs)));
		// Bindings never change after construction (only buffer contents do), so skip per-dispatch checks.
		for (const cs of Object.values(solver.shaders)) cs.fastMode = true;
		return solver;
	}

	private writeStaticParams(): void {
		const L = PARAMS_LAYOUT;
		this.paramsU32[L.n] = this.resolution;
		this.paramsData[L.dx] = this.cellSize;
		this.paramsData[L.g] = GRAVITY;
		this.paramsData[L.cfl] = CFL;
		this.paramsData[L.dtMax] = DT_MAX;
		this.paramsData[L.hDry] = H_DRY;
		this.paramsData[L.hVisible] = 0.01;
		this.paramsData[L.dryOffset] = 1.0;
	}

	private setMaterialData(p: MaterialParams): void {
		const c = frictionCoefficients(p);
		const L = PARAMS_LAYOUT;
		this.paramsU32[L.model] = c.model;
		this.paramsData[L.mu] = c.mu;
		this.paramsData[L.xi] = c.xi;
		this.paramsData[L.yieldOverRho] = c.yieldOverRho;
		this.paramsData[L.consistencyOverRho] = c.consistencyOverRho;
		this.paramsData[L.flowIndex] = c.flowIndex;
	}

	/** Writes the params uniform if anything changed. Takes effect from the next dispatch on. */
	private flushParams(): void {
		if (!this.paramsDirty) return;
		this.engine.updateUniformBuffer(this.paramsBuf, this.paramsData);
		this.paramsDirty = false;
	}

	setMaterial(params: MaterialParams): void {
		this.setMaterialData(params);
		this.paramsDirty = true;
	}

	setStyle(style: SurfaceStyle): void {
		const L = PARAMS_LAYOUT;
		this.paramsU32[L.colorMode] = style.colorMode === "depth" ? 0 : 1;
		this.paramsData[L.depthScale] = style.depthScale;
		this.paramsData[L.speedScale] = style.speedScale;
		this.paramsDirty = true;
	}

	setEmitters(emitters: EmitterParams[]): void {
		if (emitters.length > MAX_EMITTERS)
			throw new Error(`Máximo ${MAX_EMITTERS} orígenes`);
		this.emitterData.fill(0);
		this.emitterU32[0] = emitters.length;
		emitters.forEach((emitter, e) => {
			const o = EMITTERS_HEADER_FLOATS + e * EMITTER_FLOATS;
			const pts = emitter.hydrograph.slice(0, MAX_HYDROGRAPH_POINTS);
			this.emitterData[o] = emitter.position[0];
			this.emitterData[o + 1] = emitter.position[1];
			this.emitterData[o + 2] = emitter.radius;
			this.emitterU32[o + 3] = emitter.enabled ? 1 : 0;
			this.emitterU32[o + 4] = pts.length;
			this.emitterData[o + 5] = emitter.startTime;
			pts.forEach((p, k) => {
				this.emitterData[o + 8 + 2 * k] = p.t;
				this.emitterData[o + 9 + 2 * k] = p.q;
			});
		});
		this.engine.updateUniformBuffer(this.emitterBuf, this.emitterData);
		this.recountEmitter();
	}

	private recountEmitter(): void {
		this.flushParams();
		this.shaders.clear.dispatch(1);
		this.shaders.count.dispatch(this.groups, this.groups);
	}

	setTerrain(effective: Float32Array): void {
		this.terrain.update(effective);
	}

	applyEdit(batch: EditBatch): void {
		// Edit inputs are written with queue.writeBuffer, which runs before every dispatch of the
		// frame; a second edit in the same frame would overwrite the first one's inputs.
		const frame = this.engine.frameId;
		if (frame === this.lastEditFrame)
			throw new Error("applyEdit called twice in one frame; batch the edits");
		this.lastEditFrame = frame;
		const n = this.resolution;
		// Callers cap walls at MAX_WALLS (WallTool); a larger batch would overflow the command buffer.
		if (batch.walls.length > MAX_WALLS)
			throw new Error(`Máximo ${MAX_WALLS} muros`);
		let region: CellRegion | null =
			batch.mode === "replay" ? { i0: 0, j0: 0, i1: n - 1, j1: n - 1 } : null;
		if (batch.mode === "incremental")
			for (const w of batch.walls)
				region = unionRegion(region, wallRegion(w, n, this.cellSize));
		if (!region) return;
		const packed = packWalls(batch.walls, this.cellSize);
		if (packed.segCount > MAX_WALLS * MAX_WALL_SEGMENTS)
			throw new Error("Demasiados segmentos de muro");
		const ni = region.i1 - region.i0 + 1;
		const nj = region.j1 - region.j0 + 1;
		this.editHeader.set([
			batch.mode === "replay" ? 1 : 0,
			batch.walls.length,
			region.i0,
			region.j0,
			ni,
			nj,
			0,
			0,
		]);
		this.engine.updateUniformBuffer(
			this.editHeaderBuf,
			new Float32Array(this.editHeader.buffer),
		);
		this.editCmds.update(packed.cmds);
		this.editSegs.update(packed.segs);
		this.flushParams();
		this.shaders.edit.dispatch(
			Math.ceil(ni / WORKGROUP),
			Math.ceil(nj / WORKGROUP),
		);
	}

	advance(simSeconds: number, maxSubsteps: number): void {
		this.paramsData[PARAMS_LAYOUT.advance] = simSeconds;
		this.paramsDirty = true;
		this.flushParams();
		// Even count: every frame ends with the state in buffer A, which stats/surface read.
		// 50 % margin: the CFL estimate is up to one stats interval old. Surplus steps get dt = 0 and cost ~0.05 ms.
		let k = Math.ceil((simSeconds / Math.max(this.dtEstimate, 1e-4)) * 1.5) + 1;
		k = Math.min(Math.max(k, 2), maxSubsteps);
		k += k % 2;
		this.lastSubsteps = k;
		const s = this.shaders;
		const probe = this.probeRequested;
		let t0 = 0;
		if (probe) {
			// Isolate this frame's solver work: submit what is queued, then time dispatch + execution.
			this.probeRequested = false;
			this.engine.flushFramebuffer();
			t0 = performance.now();
		}
		s.begin.dispatch(1);
		for (let step = 0; step < k; step++) {
			s.dt.dispatch(1);
			(step % 2 === 0 ? s.updateAB : s.updateBA).dispatch(
				this.groups,
				this.groups,
			);
		}
		if (probe) {
			this.engine.flushFramebuffer();
			void this.engine._device.queue.onSubmittedWorkDone().then(() => {
				this.measuredStepMs = (performance.now() - t0) / k;
			});
		}
	}

	/**
	 * Times the next `advance` with the wall clock (flush + onSubmittedWorkDone).
	 * GPU timestamp queries are quantised by browsers, so they are not used.
	 */
	requestTiming(): void {
		this.probeRequested = true;
	}

	/** Refreshes the flow-surface vertex buffers from the current state. */
	updateSurface(): void {
		this.flushParams();
		this.shaders.surface.dispatch(this.groups, this.groups);
	}

	reset(): void {
		const cells = this.resolution * this.resolution;
		this.stateA.update(new Float32Array(cells * 4));
		this.stateB.update(new Float32Array(cells * 4));
		this.ctrl.update(new Uint32Array(CTRL_LAYOUT.bytes / 4));
		this.dtEstimate = DT_MAX;
		this.recountEmitter();
	}

	async readStats(): Promise<SolverStats> {
		this.flushParams();
		this.shaders.stats.dispatch(this.groups, this.groups);
		const [ctrlView, partialView] = await Promise.all([
			this.ctrl.read(),
			this.partials.read(),
		]);
		const ctrl = new DataView(
			ctrlView.buffer,
			ctrlView.byteOffset,
			ctrlView.byteLength,
		);
		const p = new Float32Array(
			partialView.buffer,
			partialView.byteOffset,
			partialView.byteLength / 4,
		);
		let sum = 0;
		let maxDepth = 0;
		let maxSpeed = 0;
		let wetCells = 0;
		let minDepth = Number.POSITIVE_INFINITY;
		for (let w = 0; w < p.length / 8; w++) {
			sum += p[8 * w];
			maxDepth = Math.max(maxDepth, p[8 * w + 1]);
			maxSpeed = Math.max(maxSpeed, p[8 * w + 2]);
			wetCells += p[8 * w + 3];
			minDepth = Math.min(minDepth, p[8 * w + 4]);
		}
		// The last dt is usually truncated to hit the frame target; the CFL limit is the honest figure.
		const speed = ctrl.getFloat32(CTRL_LAYOUT.speedBits, true);
		this.dtEstimate =
			speed > 0 ? Math.min((CFL * this.cellSize) / speed, DT_MAX) : DT_MAX;
		const dt = this.dtEstimate;
		return {
			simTime: ctrl.getFloat32(CTRL_LAYOUT.t, true),
			dt,
			steps: ctrl.getUint32(CTRL_LAYOUT.steps, true),
			volume: sum * this.cellSize * this.cellSize,
			injectedVolume: ctrl.getFloat32(CTRL_LAYOUT.injected, true),
			editRemovedVolume:
				ctrl.getUint32(CTRL_LAYOUT.editRemoved, true) * EDIT_REMOVED_UNIT,
			maxDepth,
			maxSpeed,
			minDepth,
			wetCells,
		};
	}

	async readState(): Promise<FlowState> {
		const view = await this.stateA.read();
		const data = new Float32Array(
			view.buffer,
			view.byteOffset,
			view.byteLength / 4,
		);
		const cells = this.resolution * this.resolution;
		const state: FlowState = {
			h: new Float32Array(cells),
			hu: new Float32Array(cells),
			hv: new Float32Array(cells),
		};
		for (let k = 0; k < cells; k++) {
			state.h[k] = data[4 * k];
			state.hu[k] = data[4 * k + 1];
			state.hv[k] = data[4 * k + 2];
		}
		return state;
	}

	async readTerrain(): Promise<Float32Array> {
		const view = await this.terrain.read();
		return new Float32Array(
			view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength),
		);
	}

	loadState(state: FlowState): void {
		const cells = this.resolution * this.resolution;
		const data = new Float32Array(cells * 4);
		let smax = 0;
		for (let k = 0; k < cells; k++) {
			const h = state.h[k];
			data[4 * k] = h;
			data[4 * k + 1] = state.hu[k];
			data[4 * k + 2] = state.hv[k];
			if (h > H_DRY)
				smax = Math.max(
					smax,
					(Math.abs(state.hu[k]) + Math.abs(state.hv[k])) / h +
						2 * Math.sqrt(GRAVITY * h),
				);
		}
		this.stateA.update(data);
		// Seed the CFL speed so the first step after loading is stable.
		this.ctrl.update(new Float32Array([smax]), CTRL_LAYOUT.speedBits, 4);
	}

	setClock(
		simTime: number,
		injectedVolume: number,
		editRemovedVolume: number,
	): void {
		this.ctrl.update(new Float32Array([simTime]), CTRL_LAYOUT.t, 4);
		this.ctrl.update(
			new Float32Array([injectedVolume, 0]),
			CTRL_LAYOUT.injected,
			8,
		);
		this.ctrl.update(
			new Uint32Array([Math.round(editRemovedVolume / EDIT_REMOVED_UNIT)]),
			CTRL_LAYOUT.editRemoved,
			4,
		);
	}

	dispose(): void {
		for (const b of [
			this.ctrl,
			this.terrain,
			this.baseTerrain,
			this.editCmds,
			this.editSegs,
			this.stateA,
			this.stateB,
			this.partials,
			...Object.values(this.surface),
		])
			b.dispose();
		this.engine._releaseBuffer(this.paramsBuf);
		this.engine._releaseBuffer(this.emitterBuf);
		this.engine._releaseBuffer(this.editHeaderBuf);
	}
}

/** Polls until the compute pipeline compiled; a broken shader becomes an error instead of a hang. */
async function waitReady(cs: ComputeShader, timeoutMs = 10_000): Promise<void> {
	const start = performance.now();
	while (!cs.isReady()) {
		if (performance.now() - start > timeoutMs)
			throw new Error(`Compute shader "${cs.name}" no compiló (ver consola)`);
		await new Promise((r) => setTimeout(r, 10));
	}
}
