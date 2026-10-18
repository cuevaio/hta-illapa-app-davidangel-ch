/**
 * Scalar kernels of the finite-volume scheme, shared by the CPU reference
 * solver and mirrored line by line in WGSL (src/solver/gpu/shaders.ts).
 *
 * Scheme: first-order Godunov-type update with HLL fluxes and the
 * hydrostatic reconstruction of Chen & Noelle (2017, SIAM J. Numer. Anal.
 * 55(2), eqs. 2.15-2.18). Like Audusse et al. (2004) it is well-balanced
 * (lake at rest is preserved exactly) and positivity-preserving under CFL,
 * but it keeps the full gravity force on steep slopes where the flow depth
 * is smaller than the bed step between cells — the usual debris-flow case,
 * where Audusse's reconstruction slows the flow down by orders of magnitude.
 */
import type { MaterialParams } from './Solver';
import { GRAVITY, H_DRY } from './params';

/** Normal flux through a face: mass, normal momentum, tangential momentum. */
export interface Flux {
  h: number;
  n: number;
  t: number;
}

export function velocity(h: number, m: number): number {
  return h > H_DRY ? m / h : 0;
}

/** HLL flux for reconstructed states (h, normal velocity un, tangential velocity ut). */
export function hll(hl: number, unl: number, utl: number, hr: number, unr: number, utr: number, out: Flux): void {
  if (hl <= 0 && hr <= 0) {
    out.h = out.n = out.t = 0;
    return;
  }
  const cl = Math.sqrt(GRAVITY * hl);
  const cr = Math.sqrt(GRAVITY * hr);
  // Dry-side wave speeds follow the rarefaction front (Toro).
  const sl = hl <= 0 ? unr - 2 * cr : hr <= 0 ? unl - cl : Math.min(unl - cl, unr - cr);
  const sr = hr <= 0 ? unl + 2 * cl : hl <= 0 ? unr + cr : Math.max(unl + cl, unr + cr);
  const fhl = hl * unl;
  const fnl = hl * unl * unl + 0.5 * GRAVITY * hl * hl;
  const ftl = hl * unl * utl;
  const fhr = hr * unr;
  const fnr = hr * unr * unr + 0.5 * GRAVITY * hr * hr;
  const ftr = hr * unr * utr;
  if (sl >= 0) {
    out.h = fhl;
    out.n = fnl;
    out.t = ftl;
  } else if (sr <= 0) {
    out.h = fhr;
    out.n = fnr;
    out.t = ftr;
  } else {
    const inv = 1 / (sr - sl);
    out.h = (sr * fhl - sl * fhr + sl * sr * (hr - hl)) * inv;
    out.n = (sr * fnl - sl * fnr + sl * sr * (hr * unr - hl * unl)) * inv;
    out.t = (sr * ftl - sl * ftr + sl * sr * (hr * utr - hl * utl)) * inv;
  }
}

export interface FaceFluxes {
  /** Flux as seen by the left/lower cell (includes its hydrostatic correction). */
  left: Flux;
  /** Flux as seen by the right/upper cell. */
  right: Flux;
}

export function createFaceFluxes(): FaceFluxes {
  return { left: { h: 0, n: 0, t: 0 }, right: { h: 0, n: 0, t: 0 } };
}

const scratch: Flux = { h: 0, n: 0, t: 0 };

/**
 * Well-balanced face flux between a left and a right cell. The returned normal
 * momentum fluxes already include each side's interface source term, so a cell
 * update is just U -= dt/dx · (F_right_face.left − F_left_face.right).
 */
export function faceFlux(
  hL: number, unL: number, utL: number, zL: number,
  hR: number, unR: number, utR: number, zR: number,
  out: FaceFluxes,
): void {
  const wL = hL + zL;
  const wR = hR + zR;
  const zf = Math.min(Math.max(zL, zR), Math.min(wL, wR)); // (2.15)
  const hl = Math.max(0, Math.min(wL - zf, hL)); // (2.16)
  const hr = Math.max(0, Math.min(wR - zf, hR));
  hll(hl, unL, utL, hr, unR, utR, scratch);
  out.left.h = out.right.h = scratch.h;
  out.left.t = out.right.t = scratch.t;
  // (2.17)/(2.18) multiplied by dx and folded into each side's flux.
  out.left.n = scratch.n + GRAVITY * 0.5 * (hL + hl) * (zf - zL);
  out.right.n = scratch.n - GRAVITY * 0.5 * (hr + hR) * (zR - zf);
}

export interface FrictionCoefficients {
  model: 0 | 1;
  mu: number;
  xi: number;
  yieldOverRho: number;
  consistencyOverRho: number;
  flowIndex: number;
}

export function frictionCoefficients(p: MaterialParams): FrictionCoefficients {
  const hb = p.rheology !== 'voellmy';
  return {
    model: hb ? 1 : 0,
    mu: p.mu,
    xi: p.xi,
    yieldOverRho: p.yieldStress / p.density,
    consistencyOverRho: p.viscosity / p.density,
    flowIndex: p.rheology === 'bingham' ? 1 : p.flowIndex,
  };
}

/**
 * Semi-implicit basal friction. Returns the factor (0..1) that scales the
 * momentum vector: the yield/Coulomb part can only stop the flow, never
 * reverse it, and the velocity-dependent part is treated implicitly.
 */
export function frictionScale(h: number, m: number, dt: number, c: FrictionCoefficients): number {
  if (h < H_DRY || m <= 0) return 0;
  const u = m / h;
  let num: number;
  let den: number;
  if (c.model === 0) {
    // Voellmy: τ/ρ = μ·g·h + g·u²/ξ
    num = Math.max(m - dt * c.mu * GRAVITY * h, 0);
    den = 1 + (dt * GRAVITY * u) / (c.xi * h);
  } else {
    // Herschel-Bulkley (Bingham for n = 1): τ/ρ = τy/ρ + (K/ρ)·(3u/h)ⁿ
    num = Math.max(m - dt * c.yieldOverRho, 0);
    const k = (c.consistencyOverRho * Math.pow(3, c.flowIndex) * Math.pow(Math.max(u, 1e-6), c.flowIndex - 1)) / Math.pow(h, c.flowIndex + 1);
    den = 1 + dt * k;
  }
  return num / den / m;
}
