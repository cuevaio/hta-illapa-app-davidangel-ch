import { isNodata, terrariumHeight } from '../terrarium';
import { fromHalfFloat, toHalfFloat } from './halfFloat';

/**
 * Height tile as uploaded (R16F) plus its CPU vertex grid. Built in the decode worker. Pure.
 * Heights below this depth only affect the sea colour, which saturates at −3000 m.
 */
const MIN_STORED_HEIGHT = -3000;

export interface PreparedTile {
  /** Half-float bits of `height − offset`, row 0 = north. Nodata = 0 m (sea). */
  bits: Uint16Array;
  offset: number;
  width: number;
  height: number;
  /** Metres, nodata excluded (0 when the tile has no data). */
  min: number;
  max: number;
  /** (segments + 1)² vertex heights (m, ≥ 0) exactly as the vertex shader samples them. */
  grid: Float32Array;
}

/** Terrarium RGBA → half floats around the tile mid-height (±relief/2 keeps metre precision) + vertex grid. */
export function prepareTile(rgba: ArrayLike<number>, width: number, height: number, segments: number): PreparedTile {
  const n = width * height;
  const h = new Float32Array(n);
  let min = Infinity;
  let max = -Infinity;
  for (let k = 0; k < n; k++) {
    const v = terrariumHeight(rgba[4 * k], rgba[4 * k + 1], rgba[4 * k + 2]);
    if (isNodata(v)) continue;
    h[k] = Math.max(v, MIN_STORED_HEIGHT);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min > max) min = max = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < n; k++) {
    lo = Math.min(lo, h[k]);
    hi = Math.max(hi, h[k]);
  }
  const offset = Math.round((lo + hi) / 2);
  const bits = new Uint16Array(n);
  for (let k = 0; k < n; k++) bits[k] = toHalfFloat(h[k] - offset);
  return { bits, offset, width, height, min, max, grid: vertexGrid(bits, offset, width, height, segments) };
}

/** Flat sea-level tile (outside the service area). */
export function flatTile(segments: number): PreparedTile {
  return { bits: new Uint16Array(4), offset: 0, width: 2, height: 2, min: 0, max: 0, grid: new Float32Array((segments + 1) ** 2) };
}

/**
 * Bilinear sample of the decoded half floats at each vertex uv, mapping tile edges onto edge
 * texel centres (st = texel/2 + uv·(1 − texel)), then max(·, 0): the vertex shader's heightAt.
 */
export function vertexGrid(bits: Uint16Array, offset: number, width: number, height: number, segments: number): Float32Array {
  const n = segments + 1;
  const out = new Float32Array(n * n);
  const at = (i: number, j: number) => fromHalfFloat(bits[j * width + i]) + offset;
  for (let j = 0; j < n; j++) {
    const py = (j / segments) * (height - 1);
    const j0 = Math.min(Math.floor(py), height - 2);
    const fy = py - j0;
    for (let i = 0; i < n; i++) {
      const px = (i / segments) * (width - 1);
      const i0 = Math.min(Math.floor(px), width - 2);
      const fx = px - i0;
      const top = at(i0, j0) * (1 - fx) + at(i0 + 1, j0) * fx;
      const bottom = at(i0, j0 + 1) * (1 - fx) + at(i0 + 1, j0 + 1) * fx;
      out[j * n + i] = Math.max(0, top * (1 - fy) + bottom * fy);
    }
  }
  return out;
}

/** Triangle-exact interpolation on a (cells + 1)² grid split along (i+1, j)–(i, j+1). */
function interpolate(grid: Float32Array, cells: number, stride: number, step: number, u: number, v: number): number {
  const gc = Math.min(Math.max(u * cells, 0), cells);
  const gr = Math.min(Math.max(v * cells, 0), cells);
  const c = Math.min(Math.floor(gc), cells - 1);
  const r = Math.min(Math.floor(gr), cells - 1);
  const fx = gc - c;
  const fy = gr - r;
  const idx = (cc: number, rr: number) => rr * step * stride + cc * step;
  const a = grid[idx(c, r)];
  const b = grid[idx(c + 1, r)];
  const cc = grid[idx(c, r + 1)];
  const d = grid[idx(c + 1, r + 1)];
  if (fx + fy <= 1) return a + fx * (b - a) + fy * (cc - a);
  return d + (1 - fx) * (cc - d) + (1 - fy) * (b - d);
}

/** CPU copy of one drawn tile surface (metres), uv in [0, 1] with v growing southward. */
export class TileSurface {
  constructor(readonly grid: Float32Array, readonly segments: number) {}

  /** Full-detail surface (geomorph 1). */
  fineAt(u: number, v: number): number {
    return interpolate(this.grid, this.segments, this.segments + 1, 1, u, v);
  }

  /** Parent's coarser surface (geomorph 0): only the even vertices. */
  coarseAt(u: number, v: number): number {
    return interpolate(this.grid, this.segments / 2, this.segments + 1, 2, u, v);
  }
}
