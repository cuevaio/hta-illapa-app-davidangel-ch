import { distToPolyline, wallBounds, wallProfile, type WallCommand } from './commands';

/**
 * How an edit reaches the terrain:
 *  - incremental: add `walls` on top of the current effective terrain;
 *  - replay: effective = base, then add every active wall in order.
 * Both produce bit-identical terrain for the same wall sequence, because each
 * cell accumulates the same f32 additions in the same order.
 */
export interface EditBatch {
  mode: 'incremental' | 'replay';
  walls: WallCommand[];
}

/** Inclusive cell range touched by an edit. */
export interface CellRegion {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}

export const MAX_WALLS = 256;
export const MAX_WALL_SEGMENTS = 64;

const f32 = Math.fround;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Capsule profile weight (0..1) of a wall at distance d from its axis. */
export function wallWeight(d: number, halfWidth: number, crest: number): number {
  return 1 - smoothstep(halfWidth * crest, halfWidth, d);
}

export function wallRegion(w: WallCommand, n: number, dx: number): CellRegion | null {
  const [minX, minZ, maxX, maxZ] = wallBounds(w, dx);
  const r = {
    i0: Math.max(0, Math.floor(minX / dx - 0.5)),
    j0: Math.max(0, Math.floor(minZ / dx - 0.5)),
    i1: Math.min(n - 1, Math.ceil(maxX / dx - 0.5)),
    j1: Math.min(n - 1, Math.ceil(maxZ / dx - 0.5)),
  };
  return r.i0 > r.i1 || r.j0 > r.j1 ? null : r;
}

export function unionRegion(a: CellRegion | null, b: CellRegion | null): CellRegion | null {
  if (!a) return b;
  if (!b) return a;
  return { i0: Math.min(a.i0, b.i0), j0: Math.min(a.j0, b.j0), i1: Math.max(a.i1, b.i1), j1: Math.max(a.j1, b.j1) };
}

/**
 * CPU mirror of EDIT_WGSL on the terrain copy. Returns the region it changed.
 * Only that region is touched, so the CPU copy stays cheap to keep in sync.
 */
export function applyEditCpu(z: Float32Array, base: Float32Array, n: number, dx: number, batch: EditBatch): CellRegion | null {
  let region: CellRegion | null = null;
  if (batch.mode === 'replay') region = { i0: 0, j0: 0, i1: n - 1, j1: n - 1 };
  else for (const w of batch.walls) region = unionRegion(region, wallRegion(w, n, dx));
  if (!region) return null;
  const bounds = batch.walls.map((w) => wallBounds(w, dx));
  const profiles = batch.walls.map((w) => wallProfile(w, dx));
  for (let j = region.j0; j <= region.j1; j++) {
    for (let i = region.i0; i <= region.i1; i++) {
      const k = j * n + i;
      const px = (i + 0.5) * dx;
      const pz = (j + 0.5) * dx;
      let v = batch.mode === 'replay' ? base[k] : z[k];
      for (let c = 0; c < batch.walls.length; c++) {
        const [minX, minZ, maxX, maxZ] = bounds[c];
        if (px < minX || px > maxX || pz < minZ || pz > maxZ) continue;
        const w = batch.walls[c];
        const { halfWidth, crest } = profiles[c];
        v = f32(v + f32(wallWeight(distToPolyline(px, pz, w.points), halfWidth, crest) * w.height));
      }
      z[k] = v;
    }
  }
  return region;
}

/** Floats per wall in the GPU command buffer: 3×vec4. */
export const WALL_FLOATS = 12;

/**
 * Packs walls for the GPU: per wall 3×vec4 (segStart, segCount, halfWidth, height | bounds |
 * crest, -, -, -) using the applied profile for cell size `dx`; segments as vec4 (a, b).
 */
export function packWalls(walls: WallCommand[], dx: number): { cmds: Float32Array; segs: Float32Array; segCount: number } {
  const cmds = new Float32Array(Math.max(walls.length, 1) * WALL_FLOATS);
  const segList: number[] = [];
  walls.forEach((w, c) => {
    const start = segList.length / 4;
    const pts = w.points.length === 1 ? [w.points[0], w.points[0]] : w.points;
    for (let s = 0; s + 1 < pts.length; s++) segList.push(pts[s][0], pts[s][1], pts[s + 1][0], pts[s + 1][1]);
    const [minX, minZ, maxX, maxZ] = wallBounds(w, dx);
    const { halfWidth, crest } = wallProfile(w, dx);
    cmds.set([start, segList.length / 4 - start, halfWidth, w.height, minX, minZ, maxX, maxZ, crest, 0, 0, 0], c * WALL_FLOATS);
  });
  return { cmds, segs: Float32Array.from(segList.length ? segList : [0, 0, 0, 0]), segCount: segList.length / 4 };
}

/** Decides how to bring the terrain from the `prev` active walls to `next`. */
export function planEdit(prev: WallCommand[], next: WallCommand[]): EditBatch | null {
  const isAppend = next.length >= prev.length && prev.every((w, k) => next[k] === w);
  if (isAppend) {
    const added = next.slice(prev.length);
    return added.length > 0 ? { mode: 'incremental', walls: added } : null;
  }
  return { mode: 'replay', walls: next };
}

/** Fluid displaced by raising the bed under it: removed, not moved (PoC policy). */
export function displacedDepth(h: number, dz: number): number {
  return dz > 0 ? Math.min(h, dz) : 0;
}
