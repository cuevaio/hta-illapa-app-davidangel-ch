import { describe, expect, it } from 'vitest';
import { hypsometricColor, shadeRelief } from '../../src/map/shading';

describe('overview relief shading', () => {
  it('paints sea and nodata blue, snow white-ish, lowlands green', () => {
    const sea = hypsometricColor(-200);
    expect(sea[2]).toBeGreaterThan(sea[0]);
    const nodata = hypsometricColor(Number.NaN);
    expect(nodata[2]).toBeGreaterThan(nodata[0]);
    const low = hypsometricColor(200);
    expect(low[1]).toBeGreaterThan(low[2]);
    const snow = hypsometricColor(6000);
    expect(Math.min(...snow)).toBeGreaterThan(0.85);
  });

  it('hillshades: a slope facing the NW light is brighter than one facing SE', () => {
    const w = 8;
    const h = 8;
    // Ridge along the diagonal: west half rises eastward (faces west), east half falls (faces east).
    const z = new Float32Array(w * h);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) z[r * w + c] = 1000 + 300 * (4 - Math.abs(c - 4));
    const rgba = shadeRelief(z, w, h, 1000);
    expect(rgba).toHaveLength(w * h * 4);
    const lum = (k: number) => rgba[4 * k] + rgba[4 * k + 1] + rgba[4 * k + 2];
    expect(lum(3 * w + 2)).toBeGreaterThan(lum(3 * w + 6));
    expect(rgba[3]).toBe(255);
  });
});
