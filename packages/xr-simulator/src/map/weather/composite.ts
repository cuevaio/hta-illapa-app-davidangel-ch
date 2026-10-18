import { capeLevel, CAPE_CATEGORIES } from './cape';
import { paletteColor, TEMPERATURE_PALETTE } from './palette';
import { rainColor, type RainMode } from './rain';

/**
 * CPU colouring of the GFS scalar layers into the RGBA8 textures the terrain shader drapes
 * (one texel per grid cell, row 0 north). Temperature and rain share one premultiplied texture
 * (rain over temperature); CAPE gets its own texture whose alpha encodes the category, so the
 * shader can hatch it in screen space. Pure.
 */

export interface ScalarInputs {
  temperature?: { values: Float32Array; opacity: number };
  rain?: { bands: { rate: Float32Array; accum: Float32Array }; mode: RainMode; opacity: number };
}

/** Premultiplied RGBA8 of `n` cells: rain over temperature; no data and disabled layers transparent. */
export function colorScalars(n: number, s: ScalarInputs): Uint8Array {
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    let r = 0, g = 0, b = 0, a = 0;
    const t = s.temperature?.values[i];
    if (s.temperature && t !== undefined && !Number.isNaN(t)) {
      const c = paletteColor(TEMPERATURE_PALETTE, t);
      a = (c[3] / 255) * s.temperature.opacity;
      r = c[0] * a;
      g = c[1] * a;
      b = c[2] * a;
    }
    if (s.rain) {
      const v = s.rain.mode === 'rate' ? s.rain.bands.rate[i] : s.rain.bands.accum[i];
      const c = rainColor(v, s.rain.mode);
      const ra = (c[3] / 255) * s.rain.opacity;
      if (ra > 0) {
        r = c[0] * ra + r * (1 - ra);
        g = c[1] * ra + g * (1 - ra);
        b = c[2] * ra + b * (1 - ra);
        a = ra + a * (1 - ra);
      }
    }
    out[i * 4] = Math.round(r);
    out[i * 4 + 1] = Math.round(g);
    out[i * 4 + 2] = Math.round(b);
    out[i * 4 + 3] = Math.round(a * 255);
  }
  return out;
}

/**
 * CAPE: straight RGB of the category (marginal colour where there is none, so filtering never
 * darkens the edges) and alpha = level × 85 (0 none, 85 marginal, 170 moderate, 255 high).
 */
export function colorCape(values: Float32Array): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    const level = Number.isNaN(values[i]) ? 0 : capeLevel(values[i]);
    const c = CAPE_CATEGORIES[Math.max(0, level - 1)].color;
    out.set([c[0], c[1], c[2], level * 85], i * 4);
  }
  return out;
}
