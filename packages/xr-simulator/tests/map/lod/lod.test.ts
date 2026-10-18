import { describe, expect, it } from 'vitest';
import { morphFactor, planesFrustum, selectTiles, type LodParams } from '../../../src/map/lod/lod';
import { childrenOf, isAncestor, peruFrame, tileKey, worldToLocal } from '../../../src/map/lod/quadtree';
import { lonLatToTile, lonLatToWorld, PERU_BBOX } from '../../../src/map/tileMath';

const frame = peruFrame();
const centre = { lon: (PERU_BBOX.west + PERU_BBOX.east) / 2, lat: (PERU_BBOX.south + PERU_BBOX.north) / 2 };
const all = { intersectsBox: () => true };

/** Camera `height` km straight above the Peru bbox centre (the local origin). */
function params(height: number, over: Partial<LodParams> = {}): LodParams {
  return {
    camera: [0, height, 0],
    frustum: all,
    sseFactor: 1000,
    frame,
    rootZoom: 5,
    maxZoom: 11,
    region: PERU_BBOX,
    maxScreenSpaceError: 4,
    segments: 64,
    heightRange: () => [0, 0],
    isReady: () => true,
    ...over,
  };
}

const keys = (r: { display: { z: number; x: number; y: number }[] }) => r.display.map(tileKey);
const centreRoot = lonLatToTile(centre.lon, centre.lat, 5);

describe('selectTiles (screen-space error quadtree)', () => {
  it('a far camera draws only the ready roots and requests nothing', () => {
    const r = selectTiles(params(1e7));
    expect(r.display.every((t) => t.z === 5)).toBe(true);
    expect(r.display.length).toBeGreaterThan(0);
    expect(r.requests).toEqual([]);
  });

  it('refines towards the camera: deeper tiles near it, never past maxZoom, no overlaps', () => {
    const r = selectTiles(params(30));
    const zs = r.display.map((t) => t.z);
    expect(Math.max(...zs)).toBeGreaterThan(8);
    expect(Math.max(...zs)).toBeLessThanOrEqual(11);
    for (const a of r.display) for (const b of r.display) if (a !== b) expect(isAncestor(a, b)).toBe(false);
    // The tile right under the camera is the finest one.
    const w = lonLatToWorld(centre.lon, centre.lat);
    const z = Math.max(...zs);
    const under = r.display.filter((t) => t.z === z).map((t) => Math.hypot(t.x + 0.5 - w.x * 2 ** z, t.y + 0.5 - w.y * 2 ** z));
    expect(Math.min(...under)).toBeLessThan(1.5);
  });

  it('keeps the ready parent while its children load (parent fallback, no holes)', () => {
    const rootKey = tileKey(centreRoot);
    const kids = childrenOf(centreRoot).map(tileKey);
    // Only one child ready: the parent must still be drawn and the missing children requested.
    const r = selectTiles(params(3000, { isReady: (k) => k.startsWith('5/') || k === kids[0] }));
    expect(keys(r)).toContain(rootKey);
    expect(keys(r)).not.toContain(kids[0]);
    const requested = r.requests.filter((q) => !q.prefetch).map((q) => q.key);
    for (const k of kids.slice(1)) expect(requested).toContain(k);
  });

  it('refines above the threshold and coarsens only below hysteresis × threshold', () => {
    // Root SSE = (size / 64) · 1000 / 5500 ≈ 3.5 px: between 0.75·4 and 4.
    const rootKey = tileKey(centreRoot);
    const fresh = selectTiles(params(5500));
    expect(keys(fresh)).toContain(rootKey);
    const kept = selectTiles(params(5500, { previouslyRefined: new Set([rootKey]) }));
    expect(keys(kept)).not.toContain(rootKey);
    expect(kept.refined.has(rootKey)).toBe(true);
    // Far enough (SSE < 3) it coarsens even if it was refined.
    const back = selectTiles(params(8000, { previouslyRefined: new Set([rootKey]) }));
    expect(keys(back)).toContain(rootKey);
  });

  it('prefetches the children of tiles close to refining, after every needed request', () => {
    const r = selectTiles(params(5500, { isReady: (k) => k.startsWith('5/') }));
    const pre = r.requests.filter((q) => q.prefetch).map((q) => q.key);
    for (const k of childrenOf(centreRoot).map(tileKey)) expect(pre).toContain(k);
    const ready = selectTiles(params(30, { isReady: (k) => k.startsWith('5/') }));
    const firstPrefetch = ready.requests.findIndex((q) => q.prefetch);
    if (firstPrefetch >= 0) expect(ready.requests.slice(firstPrefetch).every((q) => q.prefetch)).toBe(true);
  });

  it('requests coarse levels first, then nearest first within a level', () => {
    const r = selectTiles(params(30, { isReady: (k) => k.startsWith('5/') }));
    const needed = r.requests.filter((q) => !q.prefetch);
    for (let i = 1; i < needed.length; i++) expect(needed[i].tile.z).toBeGreaterThanOrEqual(needed[i - 1].tile.z);
    const z6 = needed.filter((q) => q.tile.z === 6);
    expect(z6[0].priority).toBeLessThanOrEqual(z6[z6.length - 1].priority);
  });

  it('caps the working set at maxTiles', () => {
    const free = selectTiles(params(10));
    expect(free.needed.size).toBeGreaterThan(60);
    const capped = selectTiles(params(10, { maxTiles: 60 }));
    expect(capped.needed.size).toBeLessThanOrEqual(60);
    expect(capped.display.length).toBeGreaterThan(0);
  });

  it('does not refine a tile whose children cannot load (canRefine)', () => {
    const r = selectTiles(params(30, { canRefine: (t) => t.z < 7 }));
    expect(Math.max(...r.display.map((t) => t.z))).toBe(7);
  });

  it('culls tiles outside the frustum', () => {
    // Only boxes east of the camera are visible.
    const east = planesFrustum([[[1, 0, 0, 0]]]);
    const r = selectTiles(params(1e7, { frustum: east }));
    for (const t of r.display) {
      const n = 2 ** t.z;
      const [xEast] = worldToLocal(frame, (t.x + 1) / n, t.y / n);
      expect(xEast).toBeGreaterThan(0);
    }
  });

  it('gives geomorph factors for displayed tiles only', () => {
    const r = selectTiles(params(30));
    expect([...r.morph.keys()].sort()).toEqual(keys(r).sort());
    for (const m of r.morph.values()) expect(m).toBeGreaterThanOrEqual(0);
  });
});

describe('morphFactor (CDLOD geomorphing)', () => {
  it('is 0 when the parent just refined and 1 at 2·hysteresis·threshold', () => {
    expect(morphFactor(4, 4, 0.75)).toBe(0);
    expect(morphFactor(6, 4, 0.75)).toBe(1);
    expect(morphFactor(5, 4, 0.75)).toBeCloseTo(0.5);
    expect(morphFactor(100, 4, 0.75)).toBe(1);
    expect(morphFactor(2, 4, 0.75)).toBe(0);
    expect(morphFactor(Infinity, 4)).toBe(1);
  });
  it('a tile is fully detailed when its parent coarsens back (parent SSE = 2·child ≥ 2·hysteresis·threshold)', () => {
    const childSse = 0.75 * 4;
    expect(morphFactor(2 * childSse, 4, 0.75)).toBe(1);
  });
});

describe('planesFrustum', () => {
  it('accepts a box if it is inside every plane of any frustum (XR: either eye)', () => {
    const left = planesFrustum([[[1, 0, 0, 0]], [[-1, 0, 0, -10]]]);
    expect(left.intersectsBox([1, 0, 0], [2, 1, 1])).toBe(true);
    expect(left.intersectsBox([-20, 0, 0], [-15, 1, 1])).toBe(true);
    expect(left.intersectsBox([-5, 0, 0], [-1, 1, 1])).toBe(false);
  });
});
