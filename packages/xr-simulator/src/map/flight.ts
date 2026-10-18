/**
 * Free-flight ("Vuelo libre") rules over the Peru overview, shared by the web fly camera
 * and the Quest/WebXR flight. Pure: units are overview scene units (km, x east, z north,
 * y up); Babylon's left-handed frame, so yaw 0 looks along +z and yaw π/2 along +x.
 */

export type Vec3 = [number, number, number];

export const FLY = {
  /** Speed floor (km/s) so flying low is never stuck. */
  minSpeed: 0.2,
  /** km/s per km of height above ground (like peru-simulator's 0.8 ×). */
  speedPerAgl: 0.8,
  /** Shift / trigger multiplier. */
  boost: 5,
  /** Minimum eye clearance over the (exaggerated) relief, km of scene. */
  clearance: 0.3,
  /** Altitude ceiling, km of scene. */
  maxAltitude: 6000,
  /** Horizontal margin around the relief, km. */
  boundsMargin: 150,
  /** Highest relief of Peru (Huascarán, rounded up), km. */
  peruTopKm: 6.8,
  /** VR start: eye height above the highest exaggerated relief, km of scene (= metres in the 1:1000 model). */
  vrStartMargin: 20,
  /**
   * VR map tilt: the rig is pitched down by this angle about the horizontal axis of its
   * heading, so the map rises toward the user like a tilted table and looking straight ahead
   * already shows (and flies toward) the ground ahead.
   */
  vrTiltDeg: 25,
} as const;

/** Snap-turn step: 30°, the same as the XR maquette snap turn. */
export const SNAP_TURN = Math.PI / 6;

export interface FlyInput {
  /** +1 forward (W), −1 back (S); analog in [−1, 1]. */
  forward: number;
  /** +1 right (D), −1 left (A). */
  strafe: number;
  /** +1 up (E), −1 down (Q). */
  vertical: number;
  boost: boolean;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function flySpeed(agl: number, boost: boolean): number {
  return Math.max(FLY.minSpeed, Math.max(0, agl) * FLY.speedPerAgl) * (boost ? FLY.boost : 1);
}

function scaled(m: Vec3, agl: number, boost: boolean): Vec3 {
  const len = Math.hypot(...m);
  if (len === 0) return [0, 0, 0];
  // Diagonals are not faster; analog deflections below 1 are slower.
  const k = (flySpeed(agl, boost) * Math.min(1, len)) / len;
  return [m[0] * k, m[1] * k, m[2] * k];
}

/** Web: velocity (km/s) from WASD/QE along the camera's horizontal heading `yaw`. */
export function flyVelocity(input: FlyInput, yaw: number, agl: number): Vec3 {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  return scaled([input.forward * fx + input.strafe * fz, input.vertical, input.forward * fz - input.strafe * fx], agl, input.boost);
}

/**
 * Quest: left stick only. Y moves along the full 3D head gaze (look up + forward climbs,
 * look down + forward descends), X strafes horizontally to the right of the head heading.
 */
export function gazeVelocity(input: { forward: number; strafe: number; boost: boolean }, gaze: Vec3, agl: number): Vec3 {
  let rx = gaze[2];
  let rz = -gaze[0];
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-6) {
    // Looking straight up/down: no heading, strafe along +x.
    rx = 1;
    rz = 0;
  } else {
    rx /= rl;
    rz /= rl;
  }
  const f = input.forward;
  const s = input.strafe;
  return scaled([f * gaze[0] + s * rx, f * gaze[1], f * gaze[2] + s * rz], agl, input.boost);
}

/** Eye height clamped to [ground × exaggeration + clearance, maxAltitude]. */
export function clampAltitude(y: number, ground: number, exaggeration: number, clearance: number, maxAltitude: number): number {
  return Math.min(maxAltitude, Math.max(y, Math.max(0, ground) * exaggeration + clearance));
}

export function clampToBounds(x: number, z: number, b: Bounds): [number, number] {
  return [Math.min(b.maxX, Math.max(b.minX, x)), Math.min(b.maxZ, Math.max(b.minZ, z))];
}

/** Thumbstick dead zone, the rest rescaled so the output still spans [−1, 1]. */
export function deadZone(v: number, dz = 0.15): number {
  const a = Math.abs(v);
  return a < dz ? 0 : (Math.sign(v) * (Math.min(1, a) - dz)) / (1 - dz);
}

/** One flick past 0.7 turns once; the stick re-arms below 0.3 (same thresholds as the maquette). */
export function snapTurnStep(state: { armed: boolean }, x: number): { state: { armed: boolean }; turn: number } {
  const a = Math.abs(x);
  if (a < 0.3) return { state: { armed: true }, turn: 0 };
  if (a > 0.7 && state.armed) return { state: { armed: false }, turn: Math.sign(x) * SNAP_TURN };
  return { state, turn: 0 };
}

/**
 * Height (km, unexaggerated) of the overview relief mesh at a scene point, interpolated on
 * exactly the mesh's triangles (a,b,d) and (b,e,d), so the clearance matches what is drawn.
 * Vertex (c, r) lies at (x0 + c·dx, z0 + r·dz); outside the grid the edge is used.
 */
export class ReliefSampler {
  constructor(
    private readonly heights: Float32Array,
    private readonly cols: number,
    private readonly rows: number,
    private readonly x0: number,
    private readonly z0: number,
    private readonly dx: number,
    private readonly dz: number,
  ) {}

  heightAt(x: number, z: number): number {
    const gc = Math.min(Math.max((x - this.x0) / this.dx, 0), this.cols - 1);
    const gr = Math.min(Math.max((z - this.z0) / this.dz, 0), this.rows - 1);
    const c = Math.min(Math.floor(gc), this.cols - 2);
    const r = Math.min(Math.floor(gr), this.rows - 2);
    const fx = gc - c;
    const fy = gr - r;
    const h = this.heights;
    const a = h[r * this.cols + c];
    const b = h[r * this.cols + c + 1];
    const d = h[(r + 1) * this.cols + c];
    const e = h[(r + 1) * this.cols + c + 1];
    if (fx + fy <= 1) return a + fx * (b - a) + fy * (d - a);
    return e + (1 - fx) * (d - e) + (1 - fy) * (b - e);
  }
}

/**
 * Entering VR puts the eye over the middle of the map, facing north, a prudent margin above
 * the highest (exaggerated) relief of Peru, so no start is at sea level or inside a mountain.
 */
export function vrStartPose(bounds: Bounds, exaggeration: number): { position: Vec3; yaw: number } {
  const x = (bounds.minX + bounds.maxX) / 2;
  const z = (bounds.minZ + bounds.maxZ) / 2;
  return { position: [x, FLY.peruTopKm * exaggeration + FLY.vrStartMargin, z], yaw: 0 };
}

/** "Zoom hacia ahí" (VR trigger, web double-click). */
export const ZOOM = {
  /** The flight ends at this fraction of the current eye→hit distance. */
  fraction: 0.35,
  /** Ease-in-out duration, s. */
  duration: 0.8,
} as const;

/**
 * Where a zoom toward `hit` ends: on the eye→hit line at ZOOM.fraction of the distance,
 * inside the bounds and at least FLY.clearance over the drawn (exaggerated) ground.
 * `groundAt` returns the exaggerated scene height, as FlightHost.groundAt.
 */
export function zoomTarget(eye: Vec3, hit: Vec3, groundAt: (x: number, z: number) => number, bounds: Bounds, fraction: number = ZOOM.fraction): Vec3 {
  const p: Vec3 = [hit[0] + (eye[0] - hit[0]) * fraction, hit[1] + (eye[1] - hit[1]) * fraction, hit[2] + (eye[2] - hit[2]) * fraction];
  const [x, z] = clampToBounds(p[0], p[2], bounds);
  return [x, clampAltitude(p[1], groundAt(x, z), 1, FLY.clearance, FLY.maxAltitude), z];
}

/** Cubic ease-in-out on [0, 1]. */
export function easeInOut(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
}

/**
 * Smooth flight from `from` to `to`: each step returns the translation to add to the eye
 * (relative, so head movement and clamps in between are kept). No rotation: yaw and roll
 * stay as they are.
 */
export class ZoomTween {
  private elapsed = 0;
  private last: Vec3;
  private cancelled = false;

  constructor(readonly from: Vec3, readonly to: Vec3, readonly duration: number = ZOOM.duration) {
    this.last = [...from];
  }

  get done(): boolean {
    return this.cancelled || this.elapsed >= this.duration;
  }

  /** Stick input or a grip grab takes over. */
  cancel(): void {
    this.cancelled = true;
  }

  step(dt: number): Vec3 {
    if (this.done) return [0, 0, 0];
    this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, dt));
    const k = easeInOut(this.elapsed / this.duration);
    const p: Vec3 = [0, 1, 2].map((i) => this.from[i] + (this.to[i] - this.from[i]) * k) as Vec3;
    const d: Vec3 = [p[0] - this.last[0], p[1] - this.last[1], p[2] - this.last[2]];
    this.last = p;
    return d;
  }
}

/** Grip held + right stick X: smooth turn rate about the vertical (rad/s at full deflection). */
export const GRIP_TURN_RATE = Math.PI / 2;
const GRIP_DEAD_ZONE = 0.15;

/**
 * Quest, grip (side button) held: the right stick climbs/descends (Y, forward = up) at the
 * altitude-proportional flight speed and turns about the vertical (X, right = turn right).
 */
export function gripStickMove(stick: { x: number; y: number }, agl: number, dt: number, boost: boolean): { dy: number; yaw: number } {
  const up = -deadZone(stick.y, GRIP_DEAD_ZONE);
  const turn = deadZone(stick.x, GRIP_DEAD_ZONE);
  return { dy: up === 0 ? 0 : up * flySpeed(agl, boost) * dt, yaw: turn === 0 ? 0 : turn * GRIP_TURN_RATE * dt };
}

/** Two grip presses within this time (s) send the VR user back to the start view. */
export const DOUBLE_TAP_S = 0.45;

/** Detects a double press from the times (s) of the button's rising edges. */
export class DoubleTap {
  private last = -Infinity;

  press(t: number): boolean {
    if (t - this.last <= DOUBLE_TAP_S) {
      this.last = -Infinity;
      return true;
    }
    this.last = t;
    return false;
  }
}

/** Horizontal axis to the right of a heading (yaw = atan2(x, z)), the VR tilt axis. */
export function vrTiltAxis(yaw: number): Vec3 {
  return [Math.cos(yaw), 0, -Math.sin(yaw)];
}
