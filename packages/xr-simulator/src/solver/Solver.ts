import type { EditBatch } from "../edit/walls";

/**
 * Common contract for every solver backend (local WebGPU, CPU reference,
 * remote). Rendering, UI and XR only talk to this interface.
 *
 * Coordinates are terrain-local metres: x along grid columns (i), z along
 * grid rows (j), cell centres at ((i + 0.5)·dx, (j + 0.5)·dx).
 */

export type RheologyModel = "voellmy" | "bingham" | "herschel-bulkley";

export interface MaterialParams {
	rheology: RheologyModel;
	/** Voellmy Coulomb friction coefficient μ (dimensionless). */
	mu: number;
	/** Voellmy turbulent coefficient ξ (m/s²). */
	xi: number;
	/** Bingham / Herschel-Bulkley yield stress τy (Pa). */
	yieldStress: number;
	/** Bingham plastic viscosity / Herschel-Bulkley consistency K (Pa·sⁿ). */
	viscosity: number;
	/** Herschel-Bulkley flow index n (1 = Bingham). */
	flowIndex: number;
	/** Bulk density ρ (kg/m³). Only the Bingham/HB stresses depend on it. */
	density: number;
}

export interface HydrographPoint {
	/** Seconds since the simulation start. */
	t: number;
	/** Discharge (m³/s). */
	q: number;
}

export interface EmitterParams {
	/** Centre in terrain-local metres (x, z). */
	position: [number, number];
	radius: number;
	/** Discharge over time since `startTime` (the hydrograph's own t starts at 0). */
	hydrograph: HydrographPoint[];
	enabled: boolean;
	/** Simulation time at which this origin starts releasing (s). */
	startTime: number;
}

export interface SolverStats {
	/** Simulated time (s). */
	simTime: number;
	/** Current stable (CFL-limited) step size (s). */
	dt: number;
	/** Solver steps taken since reset. */
	steps: number;
	/** Fluid volume currently in the domain (m³). */
	volume: number;
	/** Volume injected by emitters since reset (m³). */
	injectedVolume: number;
	/** Fluid removed by terrain edits (walls raised under the flow) since reset (m³). */
	editRemovedVolume: number;
	maxDepth: number;
	maxSpeed: number;
	/** Minimum depth over the domain; must never be negative. */
	minDepth: number;
	wetCells: number;
}

/** Depth and unit discharges per cell, row-major (index = j·n + i). */
export interface FlowState {
	h: Float32Array;
	hu: Float32Array;
	hv: Float32Array;
}

export type SolverKind = "local-gpu" | "cpu-reference" | "remote";

export interface Solver {
	readonly kind: SolverKind;
	/** Cells per side. */
	readonly resolution: number;
	/** Cell size (m). */
	readonly cellSize: number;
	setMaterial(params: MaterialParams): void;
	/** Replaces the set of debris-flow origins (at most MAX_EMITTERS). */
	setEmitters(emitters: EmitterParams[]): void;
	/** Replaces the effective terrain (base + edits) read by the solver. */
	setTerrain(effective: Float32Array): void;
	/**
	 * Applies a terrain edit before the next step. The only way edits reach the
	 * solver: callers never write its buffers. Fluid under a raised bed is
	 * removed and tallied in `editRemovedVolume`. At most one call per frame.
	 */
	applyEdit(batch: EditBatch): void;
	/**
	 * Advances simulated time by up to `simSeconds`, with at most
	 * `maxSubsteps` CFL-limited steps. Falls behind rather than going unstable.
	 */
	advance(simSeconds: number, maxSubsteps: number): void;
	/** Resets h, hu, hv and the simulated time; terrain and edits are kept. */
	reset(): void;
	/** Statistics snapshot. GPU backends read back asynchronously; never call per frame. */
	readStats(): Promise<SolverStats>;
	/** Full state readback for tests and resolution changes; never call per frame. */
	readState(): Promise<FlowState>;
	/** Loads a full state (same resolution), keeping the simulated time and injected volume. */
	loadState(state: FlowState): void;
	/** Sets the simulated time and injected-volume tally (used when changing resolution). */
	/** Restores clock and volume counters after a rebuild (resolution change). */
	setClock(
		simTime: number,
		injectedVolume: number,
		editRemovedVolume: number,
	): void;
	dispose(): void;
}
