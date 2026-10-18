import type { WorldBox } from "../lod/quadtree";
import { EARTH_CIRCUMFERENCE } from "../tileMath";

/**
 * Weather grids served by services/weather (docs/api-weather.md), pure: Web Mercator
 * (EPSG:3857 metres), row 0 north, pixel centres at (i + 0.5) / n, Uint16 LE with
 * value = raw × scale + offset and 65535 = no data, multi-band back to back.
 * The extent always comes from the response (`mercatorBounds`), never assumed.
 */

export const EARTH_RADIUS = 6378137;

/** Extent in Web Mercator metres. */
export interface MercatorBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface BandEncoding {
	name: string;
	scale: number;
	offset: number;
}

/** GET /api/layers/{id}/{time}/meta, validated. Times are epoch ms (UTC). */
export interface GridMeta {
	layer: string;
	timeId: string;
	validTime: number;
	issueTime: number;
	forecastHour: number;
	units: string;
	width: number;
	height: number;
	bounds: MercatorBounds;
	nodata: number;
	/** Every band in file order ("value" for scalar grids). */
	bands: BandEncoding[];
	/** Precipitation: when the accumulation starts (epoch ms), else null. */
	accumSince: number | null;
}

/** Decoded scalar field in data units (NaN = no data), row-major from the north edge. */
export interface ScalarGrid {
	width: number;
	height: number;
	bounds: MercatorBounds;
	values: Float32Array;
}

/** Box in the Web Mercator unit square (x east, y south), as WorldBox but origin + size. */
export interface WorldRect {
	x0: number;
	y0: number;
	w: number;
	h: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null;
const finite = (v: unknown): v is number =>
	typeof v === "number" && Number.isFinite(v);

export function parseUtc(v: unknown): number | null {
	if (typeof v !== "string") return null;
	const t = Date.parse(v);
	return Number.isNaN(t) ? null : t;
}

export function parseMercatorBounds(v: unknown): MercatorBounds | null {
	if (!isRecord(v)) return null;
	const { minX, minY, maxX, maxY } = v;
	if (
		!finite(minX) ||
		!finite(minY) ||
		!finite(maxX) ||
		!finite(maxY) ||
		minX >= maxX ||
		minY >= maxY
	)
		return null;
	return { minX, minY, maxX, maxY };
}

function parseBands(enc: Record<string, unknown>): BandEncoding[] | null {
	if (!Array.isArray(enc.bands))
		return finite(enc.scale) && finite(enc.offset)
			? [{ name: "value", scale: enc.scale, offset: enc.offset }]
			: null;
	const out: BandEncoding[] = [];
	for (const b of enc.bands) {
		if (!isRecord(b) || !finite(b.scale) || !finite(b.offset)) return null;
		out.push({
			name: String(b.name ?? `band${out.length}`),
			scale: b.scale,
			offset: b.offset,
		});
	}
	return out.length ? out : null;
}

/** Validates the untrusted metadata JSON; null when it is not usable. */
export function parseGridMeta(json: unknown): GridMeta | null {
	if (!isRecord(json) || !isRecord(json.encoding)) return null;
	const bounds = parseMercatorBounds(json.mercatorBounds);
	const validTime = parseUtc(json.validTime);
	const issueTime = parseUtc(json.issueTime);
	const { width, height, id } = json;
	const enc = json.encoding;
	if (
		!bounds ||
		validTime === null ||
		issueTime === null ||
		typeof id !== "string"
	)
		return null;
	if (
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		(width as number) <= 0 ||
		(height as number) <= 0
	)
		return null;
	if (enc.type !== "uint16" || !Number.isInteger(enc.nodata)) return null;
	const bands = parseBands(enc);
	if (!bands) return null;
	const accumulation = isRecord(json.accumulation)
		? parseUtc(json.accumulation.since)
		: null;
	return {
		layer: String(json.product ?? ""),
		timeId: id,
		validTime,
		issueTime,
		forecastHour: finite(json.forecastHour) ? json.forecastHour : 0,
		units: String(json.units ?? ""),
		width: width as number,
		height: height as number,
		bounds,
		nodata: enc.nodata as number,
		bands,
		accumSince: accumulation ?? issueTime,
	};
}

/** Decodes every band of a band-sequential Uint16 LE grid to data units (NaN = no data). */
export function decodeGridBands(
	buffer: ArrayBuffer,
	meta: GridMeta,
): Float32Array[] {
	const n = meta.width * meta.height;
	const expected = n * 2 * meta.bands.length;
	if (buffer.byteLength !== expected)
		throw new Error(`grid of ${buffer.byteLength} B, expected ${expected} B`);
	const view = new DataView(buffer);
	return meta.bands.map((b, k) => {
		const out = new Float32Array(n);
		const base = k * n * 2;
		for (let i = 0; i < n; i++) {
			const raw = view.getUint16(base + i * 2, true);
			out[i] = raw === meta.nodata ? Number.NaN : raw * b.scale + b.offset;
		}
		return out;
	});
}

export function lonLatToMercator(
	lon: number,
	lat: number,
): { x: number; y: number } {
	const phi =
		(Math.max(-85.0511287798066, Math.min(85.0511287798066, lat)) * Math.PI) /
		180;
	return {
		x: (lon * Math.PI * EARTH_RADIUS) / 180,
		y: EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + phi / 2)),
	};
}

/** Mercator metres → grid UV (u east, v = 0 at the north edge). */
export function mercatorToGridUv(
	b: MercatorBounds,
	mx: number,
	my: number,
): { u: number; v: number } {
	return {
		u: (mx - b.minX) / (b.maxX - b.minX),
		v: (b.maxY - my) / (b.maxY - b.minY),
	};
}

/** The bounds in the Web Mercator unit square of the tiles (src/map/tileMath.ts). */
export function mercatorBoxToWorld(b: MercatorBounds): WorldRect {
	const c = EARTH_CIRCUMFERENCE;
	return {
		x0: b.minX / c + 0.5,
		y0: 0.5 - b.maxY / c,
		w: (b.maxX - b.minX) / c,
		h: (b.maxY - b.minY) / c,
	};
}

/** World (unit square) point → UV inside `box`; the terrain shader does exactly this. */
export function worldToBoxUv(
	box: WorldRect,
	wx: number,
	wy: number,
): { u: number; v: number } {
	return { u: (wx - box.x0) / box.w, v: (wy - box.y0) / box.h };
}

/** Grid UV of a tile = (u0, v0) + tileUv × (du, dv). */
export function tileGridUv(
	tile: WorldBox,
	box: WorldRect,
): { u0: number; v0: number; du: number; dv: number } {
	const o = worldToBoxUv(box, tile.minX, tile.minY);
	return {
		u0: o.u,
		v0: o.v,
		du: (tile.maxX - tile.minX) / box.w,
		dv: (tile.maxY - tile.minY) / box.h,
	};
}

/**
 * Bilinear sample with texel centres at (i + 0.5) / n (GPU linear filtering, clamp to edge).
 * Null outside [0, 1]² or when a contributing cell has no data.
 */
export function sampleGrid(g: ScalarGrid, u: number, v: number): number | null {
	if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
	const fx = Math.min(g.width - 1, Math.max(0, u * g.width - 0.5));
	const fy = Math.min(g.height - 1, Math.max(0, v * g.height - 0.5));
	const x0 = Math.floor(fx);
	const y0 = Math.floor(fy);
	const x1 = Math.min(x0 + 1, g.width - 1);
	const y1 = Math.min(y0 + 1, g.height - 1);
	const tx = fx - x0;
	const ty = fy - y0;
	const at = (x: number, y: number, w: number) =>
		w === 0 ? 0 : w * g.values[y * g.width + x];
	const value =
		at(x0, y0, (1 - tx) * (1 - ty)) +
		at(x1, y0, tx * (1 - ty)) +
		at(x0, y1, (1 - tx) * ty) +
		at(x1, y1, tx * ty);
	return Number.isFinite(value) ? value : null;
}

export function sampleGridLonLat(
	g: ScalarGrid,
	lon: number,
	lat: number,
): number | null {
	const m = lonLatToMercator(lon, lat);
	const { u, v } = mercatorToGridUv(g.bounds, m.x, m.y);
	return sampleGrid(g, u, v);
}
