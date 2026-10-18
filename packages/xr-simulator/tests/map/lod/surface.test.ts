import { describe, expect, it } from 'vitest';
import { fromHalfFloat, toHalfFloat } from '../../../src/map/lod/halfFloat';
import { pickLodProfile, LOD_PROFILES } from '../../../src/map/lod/lodProfile';
import { ancestorUv, peruFrame, tileKey, tileRect } from '../../../src/map/lod/quadtree';
import { raycastGround } from '../../../src/map/lod/raycast';
import { createTileGrid } from '../../../src/map/lod/tileGeometry';
import { prepareTile, TileSurface } from '../../../src/map/lod/tileData';
import { TerrainSampler } from '../../../src/map/lod/terrainSampler';
import type { TileId } from '../../../src/map/tileMath';

describe('createTileGrid (shared tile geometry with skirts)', () => {
  const s = 4;
  const g = createTileGrid(s);
  const n = s + 1;
  it('has the (s+1)² grid plus a 4s skirt ring, all indices in range', () => {
    expect(g.positions.length / 3).toBe(n * n + 4 * s);
    expect(g.indices.length).toBe(s * s * 6 + 4 * s * 6);
    expect(Math.max(...g.indices)).toBeLessThan(n * n + 4 * s);
  });
  it('grid vertices hold the tile uv in x/z and 0 in y; skirt vertices repeat the border with y = 1', () => {
    expect([g.positions[0], g.positions[1], g.positions[2]]).toEqual([0, 0, 0]);
    const last = (n * n - 1) * 3;
    expect([g.positions[last], g.positions[last + 1], g.positions[last + 2]]).toEqual([1, 0, 1]);
    for (let b = 0; b < 4 * s; b++) {
      const k = (n * n + b) * 3;
      expect(g.positions[k + 1]).toBe(1);
      const onBorder = [0, 1].includes(g.positions[k]) || [0, 1].includes(g.positions[k + 2]);
      expect(onBorder).toBe(true);
    }
  });
  it('splits every cell along the (i+1, j)–(i, j+1) diagonal, as the geomorph expects', () => {
    // First cell: a = 0, b = 1, c = n, d = n + 1.
    expect([...g.indices.slice(0, 6)]).toEqual([0, n, 1, 1, n, n + 1]);
  });
});

describe('halfFloat', () => {
  it('round-trips heights relative to the tile minimum within 0.5 m below 2048 m of relief', () => {
    for (const h of [0, 1.25, 517.3, 2047.6]) expect(Math.abs(fromHalfFloat(toHalfFloat(h)) - h)).toBeLessThanOrEqual(0.5);
  });
});

/** RGBA Terrarium pixels for a height raster (NaN → nodata 0,0,0). */
function terrarium(h: number[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(h.length * 4);
  h.forEach((v, k) => {
    if (Number.isNaN(v)) return;
    const e = v + 32768;
    out[4 * k] = Math.floor(e / 256);
    out[4 * k + 1] = Math.floor(e) % 256;
    out[4 * k + 2] = Math.round((e - Math.floor(e)) * 256);
    out[4 * k + 3] = 255;
  });
  return out;
}

describe('prepareTile (worker decode)', () => {
  // 3×3 raster, rising eastward, one nodata pixel.
  const heights = [100, 200, 300, 100, 200, 300, 100, Number.NaN, 300];
  const t = prepareTile(terrarium(heights), 3, 3, 2);
  it('reports min/max without nodata and stores half floats relative to an offset', () => {
    expect(t.min).toBe(100);
    expect(t.max).toBe(300);
    expect(fromHalfFloat(t.bits[0]) + t.offset).toBeCloseTo(100, 0);
    // Nodata reads as sea level (0 m).
    expect(fromHalfFloat(t.bits[7]) + t.offset).toBeCloseTo(0, 0);
  });
  it('the vertex grid samples the raster like the GPU (edge texel centres at the tile edges, clamped at 0)', () => {
    expect(t.grid.length).toBe(9);
    expect(t.grid[0]).toBeCloseTo(100, 0);
    expect(t.grid[2]).toBeCloseTo(300, 0);
    expect(t.grid[4]).toBeCloseTo(200, 0);
    expect(t.grid[7]).toBeCloseTo(0, 0);
  });
});

describe('TileSurface (CPU copy of the drawn tile surface)', () => {
  // 2 segments: grid 3×3, row 0 = north.
  const s = new TileSurface(new Float32Array([0, 10, 0, 10, 50, 10, 0, 10, 0]), 2);
  it('interpolates on the mesh triangles', () => {
    expect(s.fineAt(0.5, 0.5)).toBe(50);
    // On the b–c diagonal of the first cell: the mean of b and c, not of a and d.
    expect(s.fineAt(0.25, 0.25)).toBeCloseTo(10, 5);
    expect(s.fineAt(0.3, 0.3)).toBeCloseTo(50 - 0.8 * 40, 5);
  });
  it('the coarse (parent) surface replaces odd vertices by their even neighbours', () => {
    expect(s.coarseAt(0.5, 0.5)).toBe(0);
    expect(s.coarseAt(0, 0.5)).toBe(0);
    expect(s.coarseAt(0, 0)).toBe(0);
  });
});

describe('TerrainSampler (fly clearance)', () => {
  const frame = peruFrame();
  const flat = (m: number, seg = 2) => new TileSurface(new Float32Array((seg + 1) ** 2).fill(m), seg);
  const parent: TileId = { z: 6, x: 18, y: 32 };
  const child: TileId = { z: 7, x: 36, y: 64 };
  const r = tileRect(frame, child);
  const x = r.west + r.size / 2;
  const z = r.north - r.size / 2;
  it('uses the finest loaded tile even before it is drawn', () => {
    const cache = new Map([[tileKey(parent), flat(1000)], [tileKey(child), flat(3000)]]);
    const s = new TerrainSampler(frame, { surface: (k) => cache.get(k), isDisplayed: (k) => k === tileKey(parent), rootZoom: 5, maxZoom: 11 });
    expect(s.heightAt(x, z)).toBeCloseTo(3, 6);
  });
  it('never below the drawn (coarser) surface', () => {
    const cache = new Map([[tileKey(parent), flat(4000)], [tileKey(child), flat(3000)]]);
    const s = new TerrainSampler(frame, { surface: (k) => cache.get(k), isDisplayed: (k) => k === tileKey(parent), rootZoom: 5, maxZoom: 11 });
    expect(s.heightAt(x, z)).toBeCloseTo(4, 6);
  });
  it('is 0 (sea level) where nothing is loaded', () => {
    const s = new TerrainSampler(frame, { surface: () => undefined, isDisplayed: () => false, rootZoom: 5, maxZoom: 11 });
    expect(s.heightAt(x, z)).toBe(0);
  });
});

describe('ancestorUv', () => {
  it('locates a tile inside its ancestor texture (cross-fade)', () => {
    expect(ancestorUv({ z: 7, x: 37, y: 66 }, { z: 6, x: 18, y: 33 })).toEqual({ offsetU: 0.5, offsetV: 0, scale: 0.5 });
    expect(ancestorUv({ z: 8, x: 75, y: 134 }, { z: 6, x: 18, y: 33 })).toEqual({ offsetU: 0.75, offsetV: 0.5, scale: 0.25 });
  });
});

describe('raycastGround (picking on the streamed relief)', () => {
  it('hits flat ground where the ray reaches its height', () => {
    const hit = raycastGround([0, 10, 0], [0, -1, 1], () => 2, 1000)!;
    expect(hit[1]).toBeCloseTo(2, 3);
    expect(hit[2]).toBeCloseTo(8, 3);
  });
  it('a mountain in the way stops the ray first', () => {
    const hit = raycastGround([0, 10, 0], [0, -0.1, 1], (_x, z) => (z > 20 && z < 30 ? 50 : 0), 1000)!;
    expect(hit[2]).toBeGreaterThan(19.9);
    expect(hit[2]).toBeLessThan(20.1);
  });
  it('misses when the ray never comes down', () => {
    expect(raycastGround([0, 10, 0], [0, 0.1, 1], () => 0, 1000)).toBeNull();
  });
});

describe('pickLodProfile', () => {
  it('the Quest (and phones/tablets) get lower budgets, fewer requests and a higher SSE threshold', () => {
    const d = pickLodProfile('desktop');
    const q = pickLodProfile('quest');
    expect(d).toBe(LOD_PROFILES.desktop);
    expect(q).toBe(LOD_PROFILES.quest);
    expect(pickLodProfile('mobile')).toBe(LOD_PROFILES.quest);
    expect(pickLodProfile('tablet')).toBe(LOD_PROFILES.quest);
    expect(q.maxTiles).toBeLessThan(d.maxTiles);
    expect(q.cacheCapacity).toBeLessThan(d.cacheCapacity);
    expect(q.maxConcurrent).toBeLessThan(d.maxConcurrent);
    expect(q.uploadsPerFrame).toBeLessThanOrEqual(d.uploadsPerFrame);
    expect(q.maxScreenSpaceError).toBeGreaterThan(d.maxScreenSpaceError);
    for (const p of [d, q]) expect(p.cacheCapacity).toBeGreaterThan(p.maxTiles);
  });
  it('?lod=quest|desktop overrides the device', () => {
    expect(pickLodProfile('desktop', '?lod=quest')).toBe(LOD_PROFILES.quest);
    expect(pickLodProfile('quest', '?lod=desktop')).toBe(LOD_PROFILES.desktop);
    expect(pickLodProfile('quest', '?lod=nope')).toBe(LOD_PROFILES.quest);
  });
});
