import { esNumber, paletteColor, type Palette } from './palette';
import { formatUtc } from './timeline';

/** Forecast precipitation (gfs-precip: bands rate mm/h and accum mm), after peru-simulator's src/domain/rain.ts. Pure. */

export type RainMode = 'rate' | 'accum';

export interface RainScale {
  mode: RainMode;
  label: string;
  units: string;
  /** Ascending thresholds; values at or below the first are transparent. */
  thresholds: readonly number[];
}

export const RAIN_SCALES: Readonly<Record<RainMode, RainScale>> = {
  rate: { mode: 'rate', label: 'Tasa (mm/h)', units: 'mm/h', thresholds: [0.1, 1, 2.5, 5, 10, 25, 50] },
  accum: { mode: 'accum', label: 'Acumulada (mm)', units: 'mm', thresholds: [0.5, 2, 5, 10, 25, 50, 100] },
};

/**
 * Palette in threshold-index space (index i = i-th threshold), so the skewed intensity scale
 * gets even colour steps: transparent up to the first threshold with a soft edge, light rain
 * blue/green, moderate yellow, heavy orange/red, extreme magenta.
 */
export const RAIN_INDEX_PALETTE: Palette = {
  stops: [
    { value: 0, color: [150, 200, 255, 0] },
    { value: 1, color: [150, 200, 255, 0] },
    { value: 1.15, color: [130, 190, 250, 165] },
    { value: 2, color: [60, 140, 230, 215] },
    { value: 3, color: [40, 185, 90, 225] },
    { value: 4, color: [245, 225, 50, 235] },
    { value: 5, color: [250, 150, 30, 240] },
    { value: 6, color: [230, 40, 40, 245] },
    { value: 7, color: [180, 30, 170, 250] },
  ],
};

/** Value → threshold index in [0, thresholds.length] (piecewise linear); NaN stays NaN. */
export function rainIndex(value: number, thresholds: readonly number[]): number {
  if (Number.isNaN(value)) return Number.NaN;
  if (!(value > 0)) return 0;
  let lo = 0;
  for (let i = 0; i < thresholds.length; i++) {
    const hi = thresholds[i];
    if (value <= hi) return i + (value - lo) / (hi - lo);
    lo = hi;
  }
  return thresholds.length;
}

export function rainColor(value: number, mode: RainMode): [number, number, number, number] {
  const i = rainIndex(value, RAIN_SCALES[mode].thresholds);
  return Number.isNaN(i) ? [0, 0, 0, 0] : paletteColor(RAIN_INDEX_PALETTE, i);
}

/** Legend ticks: each threshold at its even position (0..1) along the bar. */
export function rainLegendStops(mode: RainMode): { position: number; label: string }[] {
  const t = RAIN_SCALES[mode].thresholds;
  return t.map((v, i) => ({ position: (i + 1) / t.length, label: v.toLocaleString('es') }));
}

/** CSS gradient of the rain legend (index palette, opaque from the first threshold). */
export function rainGradient(): string {
  const n = RAIN_INDEX_PALETTE.stops[RAIN_INDEX_PALETTE.stops.length - 1].value;
  return `linear-gradient(to right, ${RAIN_INDEX_PALETTE.stops.slice(2).map((s) => `rgb(${s.color[0]} ${s.color[1]} ${s.color[2]}) ${Math.round(((s.value - 1) / (n - 1)) * 100)}%`).join(', ')})`;
}

const amount = (v: number) => (v < 10 ? esNumber(v, 1) : String(Math.round(v)));

export interface RainValue {
  rate: number | null;
  accum: number | null;
}

/** "2,3 mm/h (pronóstico)" or "14 mm acumulados desde 2026-10-18 06:00 UTC (pronóstico)". */
export function formatRain(value: RainValue, mode: RainMode, since: number): string {
  const v = mode === 'rate' ? value.rate : value.accum;
  if (v === null || Number.isNaN(v)) return 'sin datos aquí';
  const min = RAIN_SCALES[mode].thresholds[0];
  if (mode === 'rate') return v < min ? `sin lluvia (< ${esNumber(min, 1)} mm/h, pronóstico)` : `${amount(v)} mm/h (pronóstico)`;
  const tail = `acumulados desde ${formatUtc(since)} (pronóstico)`;
  return v < min ? `< ${esNumber(min, 1)} mm ${tail}` : `${amount(v)} mm ${tail}`;
}
