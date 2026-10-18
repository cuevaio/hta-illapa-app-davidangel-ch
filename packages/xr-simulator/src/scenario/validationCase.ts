import { CpuSolver } from "../solver/cpu/CpuSolver";
import type { HydrographPoint, MaterialParams } from "../solver/Solver";

export const NODATA = -9999;

/**
 * ESRI ASCII grid (.asc), readable by GDAL, GRASS (r.in.gdal) and Basilisk (input_grd).
 * Grid index = j·n + i with x = (i + ½)·dx and z = (j + ½)·dx; z maps to northing, so the
 * first data row is j = n − 1. NaN is written as NODATA.
 */
export function toEsriAscii(
	values: ArrayLike<number>,
	n: number,
	cellSize: number,
): string {
	const out = [
		`ncols ${n}`,
		`nrows ${n}`,
		"xllcorner 0",
		"yllcorner 0",
		`cellsize ${cellSize}`,
		`NODATA_value ${NODATA}`,
	];
	for (let j = n - 1; j >= 0; j--) {
		const row: string[] = [];
		for (let i = 0; i < n; i++) {
			const v = values[j * n + i];
			row.push(
				Number.isNaN(v) ? String(NODATA) : String(Math.round(v * 1e4) / 1e4),
			);
		}
		out.push(row.join(" "));
	}
	return out.join("\n") + "\n";
}

export function parseEsriAscii(text: string): {
	n: number;
	cellSize: number;
	values: Float32Array;
} {
	const lines = text.trim().split(/\r?\n/);
	const header: Record<string, number> = {};
	let k = 0;
	for (; k < lines.length; k++) {
		const m = /^([a-zA-Z_]+)\s+(\S+)$/.exec(lines[k].trim());
		if (!m) break;
		header[m[1].toLowerCase()] = Number(m[2]);
	}
	const n = header.ncols;
	if (n !== header.nrows) throw new Error("Only square grids are supported");
	const nodata = header.nodata_value ?? NODATA;
	const values = new Float32Array(n * n);
	for (let r = 0; r < n; r++) {
		const row = lines[k + r].trim().split(/\s+/).map(Number);
		const j = n - 1 - r;
		for (let i = 0; i < n; i++)
			values[j * n + i] = row[i] === nodata ? Number.NaN : row[i];
	}
	return { n, cellSize: header.cellsize, values };
}

export interface ReferenceCase {
	n: number;
	cellSize: number;
	terrain: Float32Array;
	material: MaterialParams;
	emitter: {
		position: [number, number];
		radius: number;
		hydrograph: HydrographPoint[];
	};
	/** Simulated time (s). */
	duration: number;
	/** How often maximum depth and arrival are sampled (s). */
	sampleInterval: number;
	/** Depth that counts as "reached" for arrival time and affected area (m). */
	threshold: number;
}

export interface ReferenceResult {
	/** Maximum flow depth over the run (m), sampled every `sampleInterval`. */
	hmax: Float32Array;
	/** First time depth ≥ threshold (s); NaN where never reached. */
	arrival: Float32Array;
	/** |volume − injected| / injected at the end. */
	massError: number;
}

/** Runs the CPU reference solver on a case and records the maps the comparison script reads. */
export function runReference(c: ReferenceCase): ReferenceResult {
	const cells = c.n * c.n;
	const s = new CpuSolver(c.n, c.cellSize, c.terrain);
	s.setMaterial(c.material);
	s.setEmitters([{ ...c.emitter, enabled: true, startTime: 0 }]);
	const hmax = new Float32Array(cells);
	const arrival = new Float32Array(cells).fill(Number.NaN);
	const sample = () => {
		const h = s.depth;
		const t = s.simTime;
		for (let k = 0; k < cells; k++) {
			if (h[k] > hmax[k]) hmax[k] = h[k];
			if (Number.isNaN(arrival[k]) && h[k] >= c.threshold) arrival[k] = t;
		}
	};
	while (s.simTime < c.duration - 1e-9) {
		s.advance(Math.min(c.sampleInterval, c.duration - s.simTime), 1_000_000);
		sample();
	}
	const st = s.statsSync();
	return {
		hmax,
		arrival,
		massError:
			st.injectedVolume > 0
				? Math.abs(st.volume - st.injectedVolume) / st.injectedVolume
				: 0,
	};
}
