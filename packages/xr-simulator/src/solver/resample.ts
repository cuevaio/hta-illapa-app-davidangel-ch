import type { FlowState } from './Solver';

function bilinear(src: ArrayLike<number>, n: number, fx: number, fz: number): number {
  const x = Math.min(Math.max(fx, 0), n - 1);
  const z = Math.min(Math.max(fz, 0), n - 1);
  const i0 = Math.min(Math.floor(x), n - 2);
  const j0 = Math.min(Math.floor(z), n - 2);
  const tx = x - i0;
  const tz = z - j0;
  const a = src[j0 * n + i0];
  const b = src[j0 * n + i0 + 1];
  const c = src[(j0 + 1) * n + i0];
  const d = src[(j0 + 1) * n + i0 + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/**
 * Resamples a flow state between square grids covering the same extent and
 * rescales it so the total fluid volume is preserved exactly.
 */
export function resampleState(state: FlowState, from: number, to: number, fromCell: number, toCell: number): FlowState {
  const cells = to * to;
  const out: FlowState = { h: new Float32Array(cells), hu: new Float32Array(cells), hv: new Float32Array(cells) };
  const ratio = from / to;
  let vOld = 0;
  for (const h of state.h) vOld += h;
  vOld *= fromCell * fromCell;
  let vNew = 0;
  for (let j = 0; j < to; j++) {
    for (let i = 0; i < to; i++) {
      const fx = (i + 0.5) * ratio - 0.5;
      const fz = (j + 0.5) * ratio - 0.5;
      const k = j * to + i;
      out.h[k] = Math.max(0, bilinear(state.h, from, fx, fz));
      out.hu[k] = bilinear(state.hu, from, fx, fz);
      out.hv[k] = bilinear(state.hv, from, fx, fz);
      vNew += out.h[k];
    }
  }
  vNew *= toCell * toCell;
  const scale = vNew > 0 ? vOld / vNew : 0;
  for (let k = 0; k < cells; k++) {
    out.h[k] *= scale;
    out.hu[k] *= scale;
    out.hv[k] *= scale;
  }
  return out;
}
