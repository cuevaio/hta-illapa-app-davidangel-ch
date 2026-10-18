import type { Vec3 } from './flight';

/**
 * Rigid moves of the user's VR rig (stick flight, grip turn, snap turn, zoom, clamps). Pure;
 * Babylon's left-handed frame, yaw about +y with yaw 0 along +z and π/2 along +x (as flight.ts).
 */

/** A rigid move of the user's rig: p' = R(yaw)·p + t (yaw only: no pitch or roll, for comfort). */
export interface Rig {
  yaw: number;
  t: Vec3;
}

export const IDENTITY_RIG: Rig = { yaw: 0, t: [0, 0, 0] };

export function rotateYaw(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

export function applyRig(m: Rig, p: Vec3): Vec3 {
  const r = rotateYaw(p, m.yaw);
  return [r[0] + m.t[0], r[1] + m.t[1], r[2] + m.t[2]];
}

/** `a` then `b`. */
export function composeRig(a: Rig, b: Rig): Rig {
  const t = applyRig(b, a.t);
  return { yaw: a.yaw + b.yaw, t };
}

/** Yaw `a` about the vertical through `pivot`. */
export function yawAbout(a: number, pivot: Vec3): Rig {
  const r = rotateYaw(pivot, a);
  return { yaw: a, t: [pivot[0] - r[0], pivot[1] - r[1], pivot[2] - r[2]] };
}
