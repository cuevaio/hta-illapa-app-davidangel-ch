import type { EmitterParams, HydrographPoint, MaterialParams } from './Solver';

export const GRAVITY = 9.81;
/** CFL number applied to dt = CFL·dx / max(|u|+|v|+2c). */
export const CFL = 0.45;
/** Upper bound for a single solver step (s). */
export const DT_MAX = 0.5;
/** Below this depth (m) a cell is dry: velocity is zero and momentum is dropped. */
export const H_DRY = 1e-4;
/** Hydrograph points supported by the GPU uniform layout. */
export const MAX_HYDROGRAPH_POINTS = 16;
/** Simultaneous debris-flow origins supported by both solvers. */
export const MAX_EMITTERS = 8;

export const DEFAULT_MATERIAL: MaterialParams = {
  rheology: 'voellmy',
  mu: 0.12,
  xi: 400,
  yieldStress: 1500,
  viscosity: 200,
  flowIndex: 1,
  density: 2000,
};

/**
 * Triangular hydrograph with the given volume (m³) and peak discharge (m³/s):
 * rises linearly to the peak in a third of the duration, then decays to zero.
 */
export function triangularHydrograph(volume: number, peakDischarge: number): HydrographPoint[] {
  const duration = (2 * volume) / Math.max(peakDischarge, 1e-6);
  return [
    { t: 0, q: 0 },
    { t: duration / 3, q: peakDischarge },
    { t: duration, q: 0 },
  ];
}

export function hydrographVolume(points: HydrographPoint[]): number {
  let v = 0;
  for (let k = 1; k < points.length; k++) v += 0.5 * (points[k].q + points[k - 1].q) * (points[k].t - points[k - 1].t);
  return v;
}

/** Piecewise-linear discharge; zero outside the hydrograph. Mirrored by `dischargeAt` in WGSL. */
export function dischargeAt(points: HydrographPoint[], t: number): number {
  if (points.length === 0 || t < points[0].t || t >= points[points.length - 1].t) return 0;
  for (let k = 1; k < points.length; k++) {
    if (t < points[k].t) {
      const a = points[k - 1];
      const b = points[k];
      const span = b.t - a.t;
      return span > 0 ? a.q + ((t - a.t) / span) * (b.q - a.q) : b.q;
    }
  }
  return 0;
}

export function defaultEmitter(position: [number, number]): EmitterParams {
  return {
    position,
    radius: 30,
    hydrograph: triangularHydrograph(60_000, 300),
    enabled: true,
    startTime: 0,
  };
}
