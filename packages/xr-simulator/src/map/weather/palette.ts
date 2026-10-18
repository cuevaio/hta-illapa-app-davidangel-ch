/** Colour ramps of the weather layers (after peru-simulator's src/domain/palette.ts), pure. */

/** RGB(A) in 0..255; alpha defaults to 255. */
export type Rgba = readonly [number, number, number, number?];

export interface Palette {
  readonly stops: readonly { value: number; color: Rgba }[];
}

/** Air temperature −10..40 °C (Andes summits to the Amazon lowlands): blue → cyan → green → yellow → orange → red. */
export const TEMPERATURE_PALETTE: Palette = {
  stops: [
    { value: -10, color: [49, 54, 149] },
    { value: -4, color: [69, 117, 180] },
    { value: 2, color: [116, 173, 209] },
    { value: 8, color: [102, 194, 165] },
    { value: 14, color: [166, 217, 106] },
    { value: 20, color: [254, 224, 139] },
    { value: 26, color: [253, 174, 97] },
    { value: 32, color: [244, 109, 67] },
    { value: 40, color: [165, 0, 38] },
  ],
};

/** Wind speed 0..100 km/h for the particle trails: light blue (calm) → green → yellow → red → magenta (gale). */
export const WIND_PALETTE: Palette = {
  stops: [
    { value: 0, color: [150, 170, 240] },
    { value: 10, color: [90, 200, 230] },
    { value: 20, color: [100, 220, 140] },
    { value: 35, color: [220, 235, 90] },
    { value: 50, color: [250, 180, 60] },
    { value: 70, color: [240, 90, 70] },
    { value: 100, color: [225, 80, 200] },
  ],
};

export function paletteRange(p: Palette): [number, number] {
  return [p.stops[0].value, p.stops[p.stops.length - 1].value];
}

const rgba = (c: Rgba): [number, number, number, number] => [c[0], c[1], c[2], c[3] ?? 255];

/** Piecewise-linear colour at `value`, clamped to the end stops. */
export function paletteColor(p: Palette, value: number): [number, number, number, number] {
  const s = p.stops;
  if (!(value > s[0].value)) return rgba(s[0].color);
  for (let i = 1; i < s.length; i++) {
    if (value <= s[i].value) {
      const a = rgba(s[i - 1].color);
      const b = rgba(s[i].color);
      const t = (value - s[i - 1].value) / (s[i].value - s[i - 1].value);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
  }
  return rgba(s[s.length - 1].color);
}

/** CSS gradient of the legend bar. */
export function cssGradient(p: Palette): string {
  const [min, max] = paletteRange(p);
  const parts = p.stops.map((s) => {
    const [r, g, b, a] = s.color;
    const color = a === undefined ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${(a / 255).toFixed(2)})`;
    return `${color} ${Math.round(((s.value - min) / (max - min)) * 100)}%`;
  });
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

export function legendTicks(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** Spanish number: decimal comma (19,6). */
export function esNumber(v: number, digits: number): string {
  return v.toLocaleString('es', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
