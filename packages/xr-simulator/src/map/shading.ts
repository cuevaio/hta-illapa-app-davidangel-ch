/**
 * Hypsometric tint + hillshade for the Peru overview (after peru-simulator's
 * terrain-material.ts), baked on the CPU into an RGBA texture.
 */

type Rgb = [number, number, number];

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Colour (0..1) for an elevation in metres; sea (h <= 0) and nodata are blue. */
export function hypsometricColor(h: number): Rgb {
  if (Number.isNaN(h) || h <= 0) return mix([0.1, 0.26, 0.42], [0.04, 0.12, 0.24], Number.isNaN(h) ? 0 : Math.min(-h / 3000, 1));
  let c: Rgb = [0.16, 0.42, 0.22];
  c = mix(c, [0.38, 0.55, 0.28], smooth(0, 600, h));
  c = mix(c, [0.62, 0.6, 0.36], smooth(600, 1800, h));
  c = mix(c, [0.62, 0.48, 0.34], smooth(1800, 3200, h));
  c = mix(c, [0.5, 0.42, 0.38], smooth(3200, 4300, h));
  c = mix(c, [0.93, 0.94, 0.96], smooth(4700, 5400, h));
  return c;
}

/** Sun from the north-west, 45° high, as (east, north, up). */
const LIGHT: Rgb = [-0.5, 0.5, Math.SQRT1_2];

/**
 * RGBA bytes (row 0 = north) for a height raster with `pixelMetres` ground spacing.
 * `zFactor` exaggerates the slopes used by the hillshade (not the colours).
 */
export function shadeRelief(heights: Float32Array, w: number, h: number, pixelMetres: number, zFactor = 1): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const at = (i: number, j: number) => {
    const v = heights[Math.min(Math.max(j, 0), h - 1) * w + Math.min(Math.max(i, 0), w - 1)];
    return Number.isNaN(v) ? 0 : Math.max(v, 0);
  };
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const z = heights[k];
      const c = hypsometricColor(z);
      let light = 1;
      if (!Number.isNaN(z) && z > 0) {
        const dEast = ((at(i + 1, j) - at(i - 1, j)) / (2 * pixelMetres)) * zFactor;
        // Rows grow southward, so the northward gradient has the opposite sign.
        const dNorth = ((at(i, j - 1) - at(i, j + 1)) / (2 * pixelMetres)) * zFactor;
        const len = Math.hypot(dEast, dNorth, 1);
        const lambert = Math.max(0, (-dEast * LIGHT[0] - dNorth * LIGHT[1] + LIGHT[2]) / len);
        light = 0.3 + 0.85 * lambert;
      }
      out[4 * k] = Math.min(255, Math.round(c[0] * light * 255));
      out[4 * k + 1] = Math.min(255, Math.round(c[1] * light * 255));
      out[4 * k + 2] = Math.min(255, Math.round(c[2] * light * 255));
      out[4 * k + 3] = 255;
    }
  }
  return out;
}
