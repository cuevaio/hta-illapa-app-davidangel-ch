/**
 * Web Mercator XYZ tile math (y grows southward), as used by our tiles API.
 * "World" coordinates are the unit square: x = 0 at 180° W, y = 0 at 85.05° N.
 */

export interface TileId {
  z: number;
  x: number;
  y: number;
}

export interface LonLatBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Peru bbox enforced by the tiles API (shared contract). */
export const PERU_BBOX: LonLatBox = { west: -81.5, south: -18.5, east: -68.5, north: 0.2 };
/** Side of every tile served by our API (px). */
export const TILE_PX = 512;
/** Highest zoom with real (not overzoomed) data for 512 px tiles (~37 m/px in Peru). */
export const MAX_REAL_ZOOM = 11;
/** Equatorial circumference of the WGS84 sphere used by Web Mercator (m). */
export const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6378137;

const DEG = Math.PI / 180;
const MAX_LAT = 85.0511287798066;

export function lonLatToWorld(lon: number, lat: number): { x: number; y: number } {
  const phi = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * DEG;
  return { x: (lon + 180) / 360, y: (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2 };
}

export function worldToLonLat(x: number, y: number): { lon: number; lat: number } {
  return { lon: x * 360 - 180, lat: (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * y))) - Math.PI / 2) / DEG };
}

export function lonLatToTile(lon: number, lat: number, z: number): TileId {
  const n = 2 ** z;
  const w = lonLatToWorld(lon, lat);
  const clamp = (v: number) => Math.max(0, Math.min(n - 1, Math.floor(v * n)));
  return { z, x: clamp(w.x), y: clamp(w.y) };
}

export function tileBoundsLonLat(t: TileId): LonLatBox {
  const n = 2 ** t.z;
  const nw = worldToLonLat(t.x / n, t.y / n);
  const se = worldToLonLat((t.x + 1) / n, (t.y + 1) / n);
  return { west: nw.lon, north: nw.lat, east: se.lon, south: se.lat };
}

/** Every tile at zoom `z` intersecting the box (row-major, north to south). */
export function tilesCovering(box: LonLatBox, z: number): TileId[] {
  const nw = lonLatToTile(box.west, box.north, z);
  const se = lonLatToTile(box.east, box.south, z);
  const out: TileId[] = [];
  for (let y = nw.y; y <= se.y; y++) for (let x = nw.x; x <= se.x; x++) out.push({ z, x, y });
  return out;
}

/** Ground metres per pixel of a `tilePx` tile at zoom `z` and latitude `lat`. */
export function groundResolution(lat: number, z: number, tilePx = TILE_PX): number {
  return (EARTH_CIRCUMFERENCE * Math.cos(lat * DEG)) / (2 ** z * tilePx);
}

/** Ground metres per world unit at `lat` (Web Mercator stretches by 1 / cos(lat)). */
export function metresPerWorldUnit(lat: number): number {
  return EARTH_CIRCUMFERENCE * Math.cos(lat * DEG);
}
