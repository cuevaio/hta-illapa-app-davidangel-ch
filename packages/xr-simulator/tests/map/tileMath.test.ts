import { describe, expect, it } from 'vitest';
import { groundResolution, lonLatToTile, lonLatToWorld, PERU_BBOX, tileBoundsLonLat, tilesCovering, worldToLonLat } from '../../src/map/tileMath';

describe('tile math (Web Mercator XYZ, y down)', () => {
  it('maps Lima to the expected z11 tile', () => {
    expect(lonLatToTile(-77.04, -12.05, 11)).toEqual({ z: 11, x: 585, y: 1093 });
  });

  it('round-trips lon/lat through world coordinates', () => {
    const w = lonLatToWorld(-77.04, -12.05);
    const back = worldToLonLat(w.x, w.y);
    expect(back.lon).toBeCloseTo(-77.04, 9);
    expect(back.lat).toBeCloseTo(-12.05, 9);
  });

  it('gives tile bounds that contain the point', () => {
    const b = tileBoundsLonLat(lonLatToTile(-77.04, -12.05, 11));
    expect(b.west).toBeLessThanOrEqual(-77.04);
    expect(b.east).toBeGreaterThan(-77.04);
    expect(b.south).toBeLessThanOrEqual(-12.05);
    expect(b.north).toBeGreaterThan(-12.05);
  });

  it('covers the Peru bbox at z6 with 3 x 5 tiles, all intersecting it', () => {
    const tiles = tilesCovering(PERU_BBOX, 6);
    expect(tiles).toHaveLength(15);
    expect(new Set(tiles.map((t) => t.x))).toEqual(new Set([17, 18, 19]));
    expect(new Set(tiles.map((t) => t.y))).toEqual(new Set([31, 32, 33, 34, 35]));
    for (const t of tiles) {
      const b = tileBoundsLonLat(t);
      expect(b.west < PERU_BBOX.east && b.east > PERU_BBOX.west && b.south < PERU_BBOX.north && b.north > PERU_BBOX.south).toBe(true);
    }
  });

  it('computes ~37 m/px for 512 px tiles at z11 in Lima', () => {
    const m = groundResolution(-12.05, 11);
    expect(m).toBeGreaterThan(36);
    expect(m).toBeLessThan(38);
  });
});
