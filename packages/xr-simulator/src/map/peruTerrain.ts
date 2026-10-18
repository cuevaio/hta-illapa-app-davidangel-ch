import type { HeightGrid } from '../scenario/terrain';
import { buildLocalGrid, localTiles, Mosaic } from './localGrid';
import { attributionFrom, DEFAULT_ATTRIBUTION, fetchTiles, type TilesClient } from './tilesClient';
import { groundResolution, MAX_REAL_ZOOM, PERU_BBOX, tilesCovering } from './tileMath';

/**
 * Overview zoom: 512 px tiles at z6 cover the Peru bbox with 3 x 5 = 15 requests
 * (~1.2 km/px), within the backend's prewarmed z0-z10 levels.
 */
export const OVERVIEW_ZOOM = 6;

export interface PeruOverviewData {
  mosaic: Mosaic;
  attribution: string;
}

/** Health check, then the coarse tiles covering Peru plus the attribution from `/capas`. */
export async function loadPeruMosaic(client: TilesClient, onProgress?: (done: number, total: number) => void): Promise<PeruOverviewData> {
  await client.health();
  const ids = tilesCovering(PERU_BBOX, OVERVIEW_ZOOM);
  const [tiles, capas] = await Promise.all([fetchTiles(client, ids, onProgress), client.layers()]);
  const first = tiles.find((t) => t !== null);
  if (!first) throw new Error('el servicio no devolvió ningún tile del Perú');
  const mosaic = Mosaic.forTiles(ids, first.size);
  for (const t of tiles) if (t) mosaic.put(t.id, t.heights);
  return { mosaic, attribution: attributionFrom(capas) ?? DEFAULT_ATTRIBUTION };
}

/** Native ground spacing of the real-data zoom (z11, 512 px) at `lat`, rounded to 0.1 m. */
export function localCellSize(lat: number): number {
  return Math.round(groundResolution(lat, MAX_REAL_ZOOM) * 10) / 10;
}

/**
 * Local metric terrain around lon/lat at the simulator's `resolution`: cells keep the native
 * z11 spacing (~37 m), so the window spans resolution x cellSize metres (e.g. 256 cells ≈ 9.5 km).
 */
export async function fetchLocalGrid(client: TilesClient, lon: number, lat: number, resolution: number): Promise<HeightGrid> {
  const cellSize = localCellSize(lat);
  const ids = localTiles(lon, lat, resolution * cellSize, MAX_REAL_ZOOM);
  const tiles = await fetchTiles(client, ids);
  const first = tiles.find((t) => t !== null);
  if (!first) throw new Error('La zona elegida está fuera de la cobertura del servicio de tiles');
  const mosaic = Mosaic.forTiles(ids, first.size);
  for (const t of tiles) if (t) mosaic.put(t.id, t.heights);
  return buildLocalGrid(mosaic, lon, lat, resolution, cellSize);
}

const coord = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;

/** Terrain label shown in the panel and used in scenario exports, e.g. "Perú −12.05, −77.04". */
export function peruLabel(lon: number, lat: number): string {
  return `Perú ${coord(lat)}, ${coord(lon)}`;
}
