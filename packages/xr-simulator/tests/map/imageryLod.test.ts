import { describe, expect, it } from 'vitest';
import { selectTiles, type LodParams } from '../../src/map/lod/lod';
import { imageryLodParams, IMAGERY_TEXEL_SSE } from '../../src/map/lod/LodTerrain';
import { LOD_PROFILES } from '../../src/map/lod/lodProfile';
import { peruFrame, tileKey } from '../../src/map/lod/quadtree';
import { transitionProgress } from '../../src/map/lod/terrainRenderer';
import { PERU_BBOX } from '../../src/map/tileMath';

const frame = peruFrame();
const all = { intersectsBox: () => true };

function params(height: number, over: Partial<LodParams> = {}): LodParams {
  return {
    camera: [0, height, 0], frustum: all, sseFactor: 1000, frame, rootZoom: 5, maxZoom: 11, region: PERU_BBOX,
    maxScreenSpaceError: 4, segments: 64, heightRange: () => [0, 0], isReady: () => true, ...over,
  };
}

describe('LOD selection with the imagery layer', () => {
  it('without imagery the selection is unchanged (thresholdScale defaults to 1, max z11)', () => {
    for (const h of [30, 3, 0.2]) {
      const a = selectTiles(params(h));
      const b = selectTiles(params(h, { thresholdScale: () => 1 }));
      expect(b.display.map(tileKey)).toEqual(a.display.map(tileKey));
      expect(b.requests).toEqual(a.requests);
      expect(Math.max(...a.display.map((t) => t.z))).toBeLessThanOrEqual(11);
    }
  });

  it('reports a priority for every needed tile (coarse first, then nearest)', () => {
    const r = selectTiles(params(30));
    for (const k of r.needed) expect(r.priority.get(k)).toBeTypeOf('number');
    const root = [...r.needed].find((k) => k.startsWith('5/'))!;
    const deep = [...r.needed].find((k) => k.startsWith('9/'))!;
    expect(r.priority.get(root)!).toBeLessThan(r.priority.get(deep)!);
  });

  it('with Satélite, refines past the terrain max z11 near the ground, capped at the provider max', () => {
    const p = imageryLodParams(LOD_PROFILES.desktop, 19);
    expect(p.maxZoom).toBe(18);
    const r = selectTiles(params(0.05, { maxZoom: p.maxZoom, thresholdScale: p.thresholdScale, maxTiles: 300 }));
    const z = Math.max(...r.display.map((t) => t.z));
    expect(z).toBeGreaterThan(11);
    expect(z).toBeLessThanOrEqual(18);
    expect(imageryLodParams(LOD_PROFILES.quest, 17).maxZoom).toBe(17);
  });

  it('imagery-only levels refine by texel size, not by the (interpolated) geometry error', () => {
    const p = imageryLodParams(LOD_PROFILES.desktop, 19);
    expect(p.thresholdScale({ z: 10, x: 0, y: 0 })).toBe(1);
    // Refining z11 → z12 happens once a 512 px texel exceeds IMAGERY_TEXEL_SSE px: SSE > 4 · 512/64 / 4 · …
    expect(p.thresholdScale({ z: 11, x: 0, y: 0 })).toBe((IMAGERY_TEXEL_SSE * 512) / 64 / LOD_PROFILES.desktop.maxScreenSpaceError);
    const coarse = selectTiles(params(0.5, { maxZoom: 18, thresholdScale: p.thresholdScale }));
    const dense = selectTiles(params(0.5, { maxZoom: 18 }));
    expect(coarse.display.length).toBeLessThan(dense.display.length);
  });

  it('cross-fade progress: 0 when the tile appears, 1 after 300 ms, clamped', () => {
    expect(transitionProgress(1000, 1000)).toBe(0);
    expect(transitionProgress(1150, 1000)).toBeCloseTo(0.5);
    expect(transitionProgress(1300, 1000)).toBe(1);
    expect(transitionProgress(5000, 1000)).toBe(1);
    expect(transitionProgress(900, 1000)).toBe(0);
  });
});
