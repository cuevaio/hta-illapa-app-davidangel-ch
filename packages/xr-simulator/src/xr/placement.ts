import type { Ray, Vec3 } from '../input/pointer';

/** Uniform scale and position of the terrain root (terrain-local origin at the grid corner). */
export interface RootPlacement {
  scale: number;
  position: Vec3;
}

export interface TerrainExtent {
  size: number;
  minHeight: number;
  maxHeight: number;
}

/** Maquette: the whole grid fits a table of `tableSize` metres, lowest point on the table top. */
export function maquettePlacement(t: TerrainExtent, table: { tableSize: number; center: Vec3 }): RootPlacement {
  const scale = table.tableSize / t.size;
  const [cx, cy, cz] = table.center;
  return { scale, position: [cx - (t.size / 2) * scale, cy - t.minHeight * scale, cz - (t.size / 2) * scale] };
}

/** Immersive: 1:1, with the terrain point (x, z) at the user's floor origin. */
export function immersivePlacement(point: [number, number], groundHeight: number): RootPlacement {
  return { scale: 1, position: [-point[0], -groundHeight, -point[1]] };
}

/** Snaps a terrain-local (x, z) point to a grid of `step` metres (0 disables snapping). */
export function snapPoint(p: [number, number], step: number): [number, number] {
  if (step <= 0) return p;
  return [Math.round(p[0] / step) * step, Math.round(p[1] / step) * step];
}

/**
 * Low-pass filter for controller rays: in a small maquette a hand tremor sweeps many metres
 * of terrain. `smoothing` in [0, 1): 0 follows the hand exactly.
 */
export class RaySmoother {
  private dir: Vec3 | null = null;

  next(ray: Ray, smoothing: number): Ray {
    const d = ray.direction;
    if (!this.dir || smoothing <= 0) {
      this.dir = [d[0], d[1], d[2]];
    } else {
      const a = 1 - smoothing;
      const m: Vec3 = [this.dir[0] + a * (d[0] - this.dir[0]), this.dir[1] + a * (d[1] - this.dir[1]), this.dir[2] + a * (d[2] - this.dir[2])];
      const len = Math.hypot(m[0], m[1], m[2]) || 1;
      this.dir = [m[0] / len, m[1] / len, m[2] / len];
    }
    return { origin: ray.origin, direction: [this.dir[0], this.dir[1], this.dir[2]] };
  }

  reset(): void {
    this.dir = null;
  }
}

/** Rotates a horizontal (x, z) vector about +Y with Babylon's convention (Matrix.RotationY). */
export function rotY([x, z]: [number, number], a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c + z * s, -x * s + z * c];
}

/** Heading of a horizontal vector, so that heading(rotY(v, a)) = heading(v) + a. */
const heading = (x: number, z: number) => Math.atan2(x, z);

/** Maquette pose: the terrain centre sits at `center`, turned by `yaw`, at `scale`. */
export interface MaquettePose {
  center: Vec3;
  yaw: number;
  scale: number;
}

/** Root transform for a pose (the pivot is the grid centre at the lowest elevation). */
export function rootFromPose(t: TerrainExtent, pose: MaquettePose): RootPlacement & { yaw: number } {
  const s = pose.scale;
  const [px, pz] = rotY([(t.size / 2) * s, (t.size / 2) * s], pose.yaw);
  return {
    scale: s,
    yaw: pose.yaw,
    position: [pose.center[0] - px, pose.center[1] - t.minHeight * s, pose.center[2] - pz],
  };
}

/** One hand holding the maquette: it follows the hand and turns with the wrist heading. */
export function grabOneHand(start: MaquettePose, from: { hand: Vec3; yaw: number }, to: { hand: Vec3; yaw: number }): MaquettePose {
  const d = to.yaw - from.yaw;
  const [ox, oz] = rotY([start.center[0] - from.hand[0], start.center[2] - from.hand[2]], d);
  return {
    center: [to.hand[0] + ox, to.hand[1] + (start.center[1] - from.hand[1]), to.hand[2] + oz],
    yaw: start.yaw + d,
    scale: start.scale,
  };
}

/** Two hands: their distance scales, their horizontal heading rotates, their midpoint moves. */
export function grabTwoHands(
  start: MaquettePose,
  from: { a: Vec3; b: Vec3 },
  to: { a: Vec3; b: Vec3 },
  bounds: { min: number; max: number },
): MaquettePose {
  const dist = (p: Vec3, q: Vec3) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  const mid = (p: Vec3, q: Vec3): Vec3 => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
  const d0 = Math.max(dist(from.a, from.b), 1e-3);
  const scale = Math.min(Math.max((start.scale * dist(to.a, to.b)) / d0, bounds.min), bounds.max);
  const k = scale / start.scale;
  const turn = heading(to.b[0] - to.a[0], to.b[2] - to.a[2]) - heading(from.b[0] - from.a[0], from.b[2] - from.a[2]);
  const m0 = mid(from.a, from.b);
  const m = mid(to.a, to.b);
  const [ox, oz] = rotY([(start.center[0] - m0[0]) * k, (start.center[2] - m0[2]) * k], turn);
  return { center: [m[0] + ox, m[1] + (start.center[1] - m0[1]) * k, m[2] + oz], yaw: start.yaw + turn, scale };
}

/** Thumbstick snap turn about the maquette centre. */
export function snapTurn(pose: MaquettePose, angle: number): MaquettePose {
  return { ...pose, yaw: pose.yaw + angle };
}

/** Controller heading from its forward direction. */
export function controllerYaw(forward: Vec3): number {
  return heading(forward[0], forward[2]);
}

/** Distance and drop below eye level of a summoned panel (m). */
const PANEL_DISTANCE = 0.6;
const PANEL_DROP = 0.15;

/**
 * Pose for the 3D panel right in front of the user: along the head's horizontal heading, a bit
 * below eye level, turned to face them (the panel's readable side looks along -Z).
 */
export function panelInFront(head: Vec3, forward: Vec3): { position: Vec3; yaw: number } {
  const yaw = heading(forward[0], forward[2]);
  return {
    position: [head[0] + Math.sin(yaw) * PANEL_DISTANCE, head[1] - PANEL_DROP, head[2] + Math.cos(yaw) * PANEL_DISTANCE],
    yaw,
  };
}
