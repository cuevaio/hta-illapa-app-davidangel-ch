import { describe, expect, it } from 'vitest';
import { buildLocalGrid, localTiles, Mosaic } from '../../src/map/localGrid';
import { prepareTile, TileSurface } from '../../src/map/lod/tileData';
import { TerrainSampler } from '../../src/map/lod/terrainSampler';
import { tileKey, worldToLocal } from '../../src/map/lod/quadtree';
import {
  CONTEXT_EXAGGERATION, CONTEXT_SCALE, contextBadge, contextCamera, contextFrame, contextLook, contextNodePosition, contextSseScale,
  contextToRootY, lonLatToPatch, mapSiteOf, patchHole, patchToContext, patchToLonLat,
} from '../../src/map/mapContext';
import { activeSiteMarker, skipLabel } from '../../src/map/overviewState';
import { localCellSize } from '../../src/map/peruTerrain';
import { lonLatToWorld, MAX_REAL_ZOOM, worldToLonLat, type TileId } from '../../src/map/tileMath';
import { peruFrame } from '../../src/map/lod/quadtree';

const LIMA = { lon: -77.04, lat: -12.05 };
const BLANCA = { lon: -77.55, lat: -9.3 };

/**
 * Synthetic relief (m) over Web Mercator world coordinates: slopes up to ~20 % along x and z,
 * smooth at the context mesh spacing (~300 m at z11 with 64 segments), so what remains at
 * the seam is placement error, not the coarser context mesh.
 */
const relief = (wx: number, wy: number) => 3000 + 1500 * Math.sin(wx * 3e3) + 1000 * Math.cos(wy * 3e3);

function terrariumTile(t: TileId, px = 512): { heights: Float32Array; rgba: Uint8Array } {
  const n = 2 ** t.z;
  const heights = new Float32Array(px * px);
  const rgba = new Uint8Array(px * px * 4);
  for (let r = 0; r < px; r++) {
    for (let c = 0; c < px; c++) {
      const h = relief((t.x + (c + 0.5) / px) / n, (t.y + (r + 0.5) / px) / n);
      const v = h + 32768;
      const k = r * px + c;
      rgba[4 * k] = Math.floor(v / 256);
      rgba[4 * k + 1] = Math.floor(v) % 256;
      rgba[4 * k + 2] = Math.round((v - Math.floor(v)) * 256) % 256;
      rgba[4 * k + 3] = 255;
      heights[k] = Math.floor(v / 256) * 256 + (Math.floor(v) % 256) + rgba[4 * k + 2] / 256 - 32768;
    }
  }
  return { heights, rgba };
}

describe('map context placement (S1)', () => {
  it('maps simulator terrain-local metres (x east, z north) to lon/lat and back, centred on the site', () => {
    const size = 256 * localCellSize(LIMA.lat);
    const c = patchToLonLat(LIMA, size, size / 2, size / 2);
    expect(c.lon).toBeCloseTo(LIMA.lon, 9);
    expect(c.lat).toBeCloseTo(LIMA.lat, 9);
    // East is +x, north is +z (no mirror).
    const ne = patchToLonLat(LIMA, size, size, size);
    expect(ne.lon).toBeGreaterThan(LIMA.lon);
    expect(ne.lat).toBeGreaterThan(LIMA.lat);
    const back = lonLatToPatch(LIMA, size, ne.lon, ne.lat);
    expect(back[0]).toBeCloseTo(size, 6);
    expect(back[1]).toBeCloseTo(size, 6);
  });

  it('uses the same geometry as the patch built by buildLocalGrid (cell centre ↔ mosaic world point)', () => {
    const dx = localCellSize(LIMA.lat);
    const size = 256 * dx;
    const c = lonLatToWorld(LIMA.lon, LIMA.lat);
    // buildLocalGrid samples cell (i, j) at world (c.x + east/m, c.y − north/m).
    const i = 10;
    const j = 200;
    const p = patchToLonLat(LIMA, size, (i + 0.5) * dx, (j + 0.5) * dx);
    const w = lonLatToWorld(p.lon, p.lat);
    const m = 40075016.68557849 * Math.cos((LIMA.lat * Math.PI) / 180);
    expect(w.x).toBeCloseTo(c.x + ((i + 0.5) * dx - size / 2) / m, 12);
    expect(w.y).toBeCloseTo(c.y - ((j + 0.5) * dx - size / 2) / m, 12);
  });

  it('places the context frame (km) under the simulator root: context km × 1000 + patch centre = root metres', () => {
    const size = 9000;
    expect(CONTEXT_SCALE).toBe(1000);
    expect(contextNodePosition(size)).toEqual([4500, 0, 4500]);
    expect(patchToContext(size, 4500, 4500)).toEqual([0, 0]);
    expect(patchToContext(size, 9000, 0)).toEqual([4.5, -4.5]);
    // The context frame's local km at a point equals the patch offset from the centre.
    const f = contextFrame(LIMA);
    const ll = patchToLonLat(LIMA, size, 9000, 0);
    const w = lonLatToWorld(ll.lon, ll.lat);
    const [x, z] = worldToLocal(f, w.x, w.y);
    expect(x).toBeCloseTo(4.5, 9);
    expect(z).toBeCloseTo(-4.5, 9);
  });

  it('cuts a hole exactly over the patch mesh (cell centres), in context km', () => {
    expect(patchHole({ size: 1000, cellSize: 10 })).toEqual([-0.495, -0.495, 0.495, 0.495]);
  });

  it('keeps the vertical scale consistent: context ×1, one root metre per metre of height, like the patch and the flow', () => {
    expect(CONTEXT_EXAGGERATION).toBe(1);
    expect(contextLook().exaggeration).toBe(CONTEXT_EXAGGERATION);
    // Shader: y_km = h · 0.001 · exaggeration; root y = y_km · CONTEXT_SCALE.
    expect(contextToRootY(2.5)).toBe(2500);
  });

  it('meets the patch heights at the seam within tolerance (same z11 source)', () => {
    for (const site of [LIMA, BLANCA]) {
      const dx = localCellSize(site.lat);
      const n = 64;
      const size = n * dx;
      const ids = localTiles(site.lon, site.lat, size, MAX_REAL_ZOOM);
      const mosaic = Mosaic.forTiles(ids, 512);
      const surfaces = new Map<string, TileSurface>();
      for (const t of ids) {
        const { heights, rgba } = terrariumTile(t);
        mosaic.put(t, heights);
        surfaces.set(tileKey(t), new TileSurface(prepareTile(rgba, 512, 512, 64).grid, 64));
      }
      const grid = buildLocalGrid(mosaic, site.lon, site.lat, n, dx);
      const sampler = new TerrainSampler(contextFrame(site), { surface: (k) => surfaces.get(k), isDisplayed: (k) => surfaces.has(k), rootZoom: 5, maxZoom: MAX_REAL_ZOOM });
      let worst = 0;
      for (let k = 0; k < n; k++) {
        // The four edges of the patch.
        for (const [i, j] of [[k, 0], [k, n - 1], [0, k], [n - 1, k]]) {
          const [cx, cz] = patchToContext(size, (i + 0.5) * dx, (j + 0.5) * dx);
          const context = contextToRootY(sampler.heightAt(cx, cz) * CONTEXT_EXAGGERATION);
          worst = Math.max(worst, Math.abs(context - grid.heights[j * n + i]));
        }
      }
      expect(worst).toBeLessThan(3);
    }
  });

  it('has a map context only for terrains with a real location ("sin contexto" for synthetic and DEM files)', () => {
    expect(mapSiteOf({ kind: 'synthetic' })).toBeNull();
    expect(mapSiteOf({ kind: 'dem' })).toBeNull();
    expect(mapSiteOf({ kind: 'dem', site: LIMA })).toEqual(LIMA);
    expect(contextBadge(null)).toBe('Sin contexto de mapa (terreno sin ubicación real)');
    expect(contextBadge(LIMA)).toBe('Contexto: relieve del Perú alrededor (escala vertical ×1)');
  });

  it('coarsens the context LOD while the simulation runs and widens the camera only with a context', () => {
    expect(contextSseScale(false)).toBe(1);
    expect(contextSseScale(true)).toBe(2);
    expect(contextCamera(9000, false)).toEqual({ upperRadiusLimit: 54000, maxZ: 50000 });
    const wide = contextCamera(9000, true);
    expect(wide.upperRadiusLimit).toBeGreaterThanOrEqual(150_000);
    expect(wide.maxZ).toBeGreaterThan(wide.upperRadiusLimit * 2);
  });
});

describe('overview marker of the active simulation (S1)', () => {
  it('sits at the site, in overview km, with the patch footprint', () => {
    const f = peruFrame();
    const m = activeSiteMarker(f, { ...BLANCA, size: 9300 }, 3, 4000);
    const w = lonLatToWorld(BLANCA.lon, BLANCA.lat);
    const [x, z] = worldToLocal(f, w.x, w.y);
    expect(m.x).toBeCloseTo(x, 9);
    expect(m.z).toBeCloseTo(z, 9);
    expect(m.footprint).toBeCloseTo(9.3, 9);
    expect(m.ground).toBeCloseTo(12, 9);
    const back = worldToLonLat(w.x, w.y);
    expect(back.lat).toBeCloseTo(BLANCA.lat, 9);
  });

  it('offers re-entering the active simulation, else "Ir al simulador" as before', () => {
    expect(skipLabel(null)).toBe('Ir al simulador');
    expect(skipLabel('Perú −9.30, −77.55')).toBe('Volver a la simulación (Perú −9.30, −77.55)');
  });
});
