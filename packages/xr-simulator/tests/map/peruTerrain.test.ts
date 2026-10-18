import { describe, expect, it } from 'vitest';
import { fetchLocalGrid, loadPeruMosaic, localCellSize, peruLabel } from '../../src/map/peruTerrain';
import { DEFAULT_ATTRIBUTION, TilesClient, TilesUnavailableError } from '../../src/map/tilesClient';

/** 512 px synthetic tiles at a constant height (R=131, G=232 → 1000 m); pixel 0 is nodata. */
const decode = async () => {
  const rgba = new Uint8Array(512 * 512 * 4);
  for (let k = 0; k < 512 * 512; k++) rgba.set(k === 0 ? [0, 0, 0, 255] : [131, 232, 0, 255], 4 * k);
  return { width: 512, height: 512, rgba };
};

function fakeApi(urls: string[], capas: unknown = { capas: [] }) {
  return new TilesClient('/tiles-api', async (u) => {
    urls.push(u);
    if (u.endsWith('/salud')) return new Response('{"estado":"ok"}', { status: 200 });
    if (u.endsWith('/capas')) return new Response(JSON.stringify(capas), { status: 200 });
    return new Response(new Uint8Array([1]), { status: 200 });
  }, decode);
}

describe('Peru terrain from our tiles API', () => {
  it('loads the overview from 15 z6 tiles and falls back to the static attribution', async () => {
    const urls: string[] = [];
    const data = await loadPeruMosaic(fakeApi(urls));
    expect(urls.filter((u) => u.includes('/tiles/terreno/v1/6/'))).toHaveLength(15);
    expect(data.mosaic.width).toBe(3 * 512);
    expect(data.mosaic.height).toBe(5 * 512);
    expect(data.attribution).toBe(DEFAULT_ATTRIBUTION);
  });

  it('fails with TilesUnavailableError when /salud does not answer', async () => {
    const client = new TilesClient('/tiles-api', async () => { throw new TypeError('Failed to fetch'); }, decode);
    await expect(loadPeruMosaic(client)).rejects.toBeInstanceOf(TilesUnavailableError);
  });

  it('builds a filled local grid at the simulator resolution with native z11 spacing', async () => {
    const urls: string[] = [];
    const grid = await fetchLocalGrid(fakeApi(urls), -77.04, -12.05, 128);
    expect(urls.every((u) => u.includes('/tiles/terreno/v1/11/'))).toBe(true);
    expect(grid.resolution).toBe(128);
    expect(grid.cellSize).toBe(localCellSize(-12.05));
    expect(grid.cellSize).toBeGreaterThan(36);
    expect(grid.heights.every((h) => Math.abs(h - 1000) < 1e-3)).toBe(true);
  });

  it('labels the terrain with lat, lon', () => {
    expect(peruLabel(-77.0428, -12.0464)).toBe('Perú −12.05, −77.04');
  });
});
