import type { HeightGrid } from '../scenario/terrain';
import { lonLatToWorld, metresPerWorldUnit, type TileId } from './tileMath';

/**
 * Heights of a rectangular block of same-zoom tiles stitched into one raster
 * (row 0 = north). Missing tiles and nodata pixels are NaN.
 */
export class Mosaic {
  readonly heights: Float32Array;
  readonly width: number;
  readonly height: number;

  constructor(readonly z: number, readonly x0: number, readonly y0: number, readonly cols: number, readonly rows: number, readonly tileSize: number) {
    this.width = cols * tileSize;
    this.height = rows * tileSize;
    this.heights = new Float32Array(this.width * this.height).fill(Number.NaN);
  }

  static forTiles(tiles: TileId[], tileSize: number): Mosaic {
    if (!tiles.length) throw new Error('Sin tiles para el mosaico');
    const xs = tiles.map((t) => t.x);
    const ys = tiles.map((t) => t.y);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    return new Mosaic(tiles[0].z, x0, y0, Math.max(...xs) - x0 + 1, Math.max(...ys) - y0 + 1, tileSize);
  }

  put(t: TileId, heights: Float32Array): void {
    const s = this.tileSize;
    if (t.z !== this.z || heights.length !== s * s) throw new Error('Tile incompatible con el mosaico');
    const ox = (t.x - this.x0) * s;
    const oy = (t.y - this.y0) * s;
    if (ox < 0 || oy < 0 || ox >= this.width || oy >= this.height) return;
    for (let r = 0; r < s; r++) this.heights.set(heights.subarray(r * s, (r + 1) * s), (oy + r) * this.width + ox);
  }

  /** World coordinates of the mosaic's north-west corner and its size (world units). */
  get worldBounds(): { x: number; y: number; size: number } {
    const n = 2 ** this.z;
    return { x: this.x0 / n, y: this.y0 / n, size: 1 / n };
  }

  /** Pixel (column, row) of a world point, pixel centres at integers. */
  toPixel(wx: number, wy: number): [number, number] {
    const scale = 2 ** this.z * this.tileSize;
    return [wx * scale - this.x0 * this.tileSize - 0.5, wy * scale - this.y0 * this.tileSize - 0.5];
  }

  /** Bilinear sample at a world point; nodata corners are skipped, NaN when none is valid. */
  sampleWorld(wx: number, wy: number): number {
    const [px, py] = this.toPixel(wx, wy);
    return this.samplePixel(px, py);
  }

  samplePixel(px: number, py: number): number {
    const w = this.width;
    const h = this.height;
    if (px < -0.5 || py < -0.5 || px > w - 0.5 || py > h - 0.5) return Number.NaN;
    const x = Math.min(Math.max(px, 0), w - 1);
    const y = Math.min(Math.max(py, 0), h - 1);
    const i0 = Math.floor(x);
    const j0 = Math.floor(y);
    const i1 = Math.min(i0 + 1, w - 1);
    const j1 = Math.min(j0 + 1, h - 1);
    const fx = x - i0;
    const fy = y - j0;
    let sum = 0;
    let wsum = 0;
    const add = (i: number, j: number, wt: number) => {
      const v = this.heights[j * w + i];
      if (wt > 0 && !Number.isNaN(v)) {
        sum += v * wt;
        wsum += wt;
      }
    };
    add(i0, j0, (1 - fx) * (1 - fy));
    add(i1, j0, fx * (1 - fy));
    add(i0, j1, (1 - fx) * fy);
    add(i1, j1, fx * fy);
    if (wsum > 0) return sum / wsum;
    // All weighted corners are nodata: fall back to any valid corner.
    for (const [i, j] of [[i0, j0], [i1, j0], [i0, j1], [i1, j1]]) {
      const v = this.heights[j * w + i];
      if (!Number.isNaN(v)) return v;
    }
    return Number.NaN;
  }
}

/** Tiles at zoom `z` under a square window of `extent` metres centred on lon/lat (plus one pixel of margin). */
export function localTiles(lon: number, lat: number, extent: number, z: number): TileId[] {
  const c = lonLatToWorld(lon, lat);
  const n = 2 ** z;
  const half = extent / 2 / metresPerWorldUnit(lat) + 1 / (n * 512);
  const clamp = (v: number) => Math.max(0, Math.min(n - 1, Math.floor(v * n)));
  const out: TileId[] = [];
  for (let y = clamp(c.y - half); y <= clamp(c.y + half); y++) for (let x = clamp(c.x - half); x <= clamp(c.x + half); x++) out.push({ z, x, y });
  return out;
}

/**
 * Local metric HeightGrid of `resolution`² cells of `cellSize` m centred on lon/lat.
 * Cell (i, j) sits at east = (i + 0.5) * cellSize - size / 2 and north = (j + 0.5) * cellSize - size / 2
 * (x east, z north). Web Mercator distances are divided by 1/cos(lat) of the centre: over a
 * window of a few tens of km the scale error stays below 0.1 %. Nodata is filled (see fillNodata).
 */
export function buildLocalGrid(m: Mosaic, lon: number, lat: number, resolution: number, cellSize: number): HeightGrid {
  const c = lonLatToWorld(lon, lat);
  const perMetre = 1 / metresPerWorldUnit(lat);
  const size = resolution * cellSize;
  const heights = new Float32Array(resolution * resolution);
  for (let j = 0; j < resolution; j++) {
    const north = (j + 0.5) * cellSize - size / 2;
    for (let i = 0; i < resolution; i++) {
      const east = (i + 0.5) * cellSize - size / 2;
      heights[j * resolution + i] = m.sampleWorld(c.x + east * perMetre, c.y - north * perMetre);
    }
  }
  fillNodata(heights, resolution, resolution);
  return { resolution, cellSize, heights };
}

/**
 * Nodata rule for the simulator: every NaN cell takes the mean of its valid 8-neighbours,
 * growing inward pass after pass (a smooth patch, no artificial pits or walls).
 * Returns the number of cells filled; throws when there is no valid cell at all.
 */
export function fillNodata(h: Float32Array, w: number, rows: number): number {
  let missing = 0;
  for (let k = 0; k < h.length; k++) if (Number.isNaN(h[k])) missing++;
  if (missing === h.length) throw new Error('Sin datos de elevación en la zona elegida');
  const total = missing;
  while (missing > 0) {
    const next = Float32Array.from(h);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        if (!Number.isNaN(h[k])) continue;
        let sum = 0;
        let cnt = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            const jj = j + dj;
            if ((di || dj) && ii >= 0 && jj >= 0 && ii < w && jj < rows) {
              const v = h[jj * w + ii];
              if (!Number.isNaN(v)) {
                sum += v;
                cnt++;
              }
            }
          }
        }
        if (cnt) {
          next[k] = sum / cnt;
          missing--;
        }
      }
    }
    h.set(next);
  }
  return total;
}
