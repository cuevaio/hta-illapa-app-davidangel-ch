/** Square height grid sampled at cell centres, row-major (index = j·n + i). */
export interface HeightGrid {
	resolution: number;
	/** Cell size (m). */
	cellSize: number;
	heights: Float32Array;
}

/**
 * Two-layer terrain: `base` is immutable, `effective` = base + edits and is
 * what the solver reads. `effective` doubles as the CPU copy used for raycasts.
 */
export class Terrain {
	readonly resolution: number;
	readonly cellSize: number;
	readonly base: Float32Array;
	readonly effective: Float32Array;

	constructor(grid: HeightGrid) {
		this.resolution = grid.resolution;
		this.cellSize = grid.cellSize;
		this.base = Float32Array.from(grid.heights);
		this.effective = Float32Array.from(grid.heights);
	}

	get size(): number {
		return this.resolution * this.cellSize;
	}

	/** Bilinear elevation at terrain-local (x, z); clamps outside the domain. */
	/** Bilinear elevation of the effective terrain (base + edits). */
	heightAt(x: number, z: number): number {
		return this.sample(this.effective, x, z);
	}

	/** Bilinear elevation of the unedited terrain. */
	baseHeightAt(x: number, z: number): number {
		return this.sample(this.base, x, z);
	}

	private sample(e: Float32Array, x: number, z: number): number {
		const n = this.resolution;
		const fx = Math.min(Math.max(x / this.cellSize - 0.5, 0), n - 1);
		const fz = Math.min(Math.max(z / this.cellSize - 0.5, 0), n - 1);
		const i0 = Math.min(Math.floor(fx), n - 2);
		const j0 = Math.min(Math.floor(fz), n - 2);
		const tx = fx - i0;
		const tz = fz - j0;
		const a = e[j0 * n + i0];
		const b = e[j0 * n + i0 + 1];
		const c = e[(j0 + 1) * n + i0];
		const d = e[(j0 + 1) * n + i0 + 1];
		return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
	}

	minMax(): [number, number] {
		let lo = Number.POSITIVE_INFINITY;
		let hi = Number.NEGATIVE_INFINITY;
		for (const v of this.effective) {
			if (v < lo) lo = v;
			if (v > hi) hi = v;
		}
		return [lo, hi];
	}
}

/** Resamples a grid to `resolution`² cells over the same extent (bilinear). */
export function resampleGrid(src: HeightGrid, resolution: number): HeightGrid {
	if (src.resolution === resolution)
		return { ...src, heights: Float32Array.from(src.heights) };
	const size = src.resolution * src.cellSize;
	const cellSize = size / resolution;
	const out = new Float32Array(resolution * resolution);
	const tmp = new Terrain(src);
	for (let j = 0; j < resolution; j++) {
		for (let i = 0; i < resolution; i++)
			out[j * resolution + i] = tmp.heightAt(
				(i + 0.5) * cellSize,
				(j + 0.5) * cellSize,
			);
	}
	return { resolution, cellSize, heights: out };
}

// --- Synthetic ravine --------------------------------------------------------

export const SYNTHETIC_SIZE = 2048;

const smoothstep = (a: number, b: number, x: number) => {
	const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
	return t * t * (3 - 2 * t);
};

/** Lateral position (0..1) of the channel thalweg at downstream coordinate s (0..1). */
export function channelCenter(s: number): number {
	const fan = smoothstep(0.5, 0.65, s);
	return 0.5 + 0.04 * Math.sin(s * 6 * Math.PI) * (1 - fan);
}

function hash(i: number, j: number): number {
	let h = (i * 374761393 + j * 668265263) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number): number {
	const i = Math.floor(x);
	const j = Math.floor(y);
	const tx = x - i;
	const ty = y - j;
	const sx = tx * tx * (3 - 2 * tx);
	const sy = ty * ty * (3 - 2 * ty);
	const a = hash(i, j);
	const b = hash(i + 1, j);
	const c = hash(i, j + 1);
	const d = hash(i + 1, j + 1);
	return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

function fbm(x: number, y: number): number {
	let v = 0;
	let amp = 0.5;
	let f = 1;
	for (let o = 0; o < 4; o++) {
		v += amp * (valueNoise(x * f, y * f) - 0.5);
		amp *= 0.5;
		f *= 2;
	}
	return v;
}

/** Downstream position of the fan apex (valley mouth). */
const FAN_APEX_S = 0.58;
/** Fan surface gradient (≈4.3°), flatter than atan(μ) for the default μ so material deposits. */
const FAN_SLOPE = 0.075;

const longProfile = (s: number) => 450 * Math.exp(-3.2 * s) + 60 * (1 - s);

/**
 * Elevation (m) of the synthetic catchment at normalised coordinates:
 * s = downstream (0 = head, 1 = toe), y = lateral (0..1).
 * Steep incised ravine between flanks that opens at the apex into a radial
 * alluvial fan, with a low rim along the domain edge to keep the deposit in.
 */
export function syntheticElevation(
	s: number,
	y: number,
	size = SYNTHETIC_SIZE,
): number {
	const fan = smoothstep(FAN_APEX_S - 0.08, FAN_APEX_S + 0.07, s);
	const dy = y - channelCenter(s);
	const flanks =
		0.3 * size * Math.abs(dy) ** 1.3 * smoothstep(0, 0.12, Math.abs(dy));
	const channel = 18 * Math.exp(-((dy / 0.025) ** 2));
	const valley = longProfile(s) + flanks - channel;
	const r = Math.hypot(s - FAN_APEX_S, y - 0.5);
	const fanSurface = longProfile(FAN_APEX_S) - FAN_SLOPE * size * r;
	const edge = Math.max(s, Math.abs(y - 0.5) * 2);
	const rim = 25 * smoothstep(0.92, 1.0, edge);
	return valley * (1 - fan) + fanSurface * fan + rim + 4 * fbm(s * 24, y * 24);
}

export function createSyntheticRavine(
	resolution: number,
	size = SYNTHETIC_SIZE,
): HeightGrid {
	const cellSize = size / resolution;
	const heights = new Float32Array(resolution * resolution);
	for (let j = 0; j < resolution; j++) {
		for (let i = 0; i < resolution; i++) {
			heights[j * resolution + i] = syntheticElevation(
				(i + 0.5) / resolution,
				(j + 0.5) / resolution,
				size,
			);
		}
	}
	return { resolution, cellSize, heights };
}

/** Default emitter location for the synthetic ravine: in the channel near the head. */
export function syntheticEmitterPosition(
	size = SYNTHETIC_SIZE,
): [number, number] {
	const s = 0.08;
	return [s * size, channelCenter(s) * size];
}
