import type { Bounds, Vec3 } from '../map/flight';
import { grabOneHand, grabTwoHands, rotY, type MaquettePose } from './placement';

/**
 * "Maqueta" of the Peru map in VR (S2): the whole map on a virtual table in front of the user.
 * Pure. The map root (local km, x east, z north, y up) is scaled to metres of the XR space,
 * like the simulator maquette (src/xr/placement.ts), so the user stays at real scale and the
 * LOD follows the XR camera through the inverse root transform.
 */
export const MAP_TABLE = {
  /** Table width (m) the longest side of the map is fitted to. */
  width: 1.3,
  /** Distance (m) from the head to the table centre, along the horizontal gaze. */
  distance: 0.75,
  /** Table top below eye level (m). */
  drop: 0.55,
  /** Lowest table top (m above the floor), for seated users. */
  minHeight: 0.6,
  /**
   * Extra vertical exaggeration on the table, on top of the web slider: at ~0.5 mm per km
   * even the Andes ×3 would be ~1 cm high.
   */
  reliefBoost: 3,
  /** Two-hand scaling limits of the table width (m). */
  minWidth: 0.3,
  maxWidth: 8,
} as const;

/** Map root transform: non-uniform scaling (relief boost on y), yaw about +y, then position. */
export interface MapRootTransform {
  scaling: Vec3;
  yaw: number;
  position: Vec3;
}

const span = (b: Bounds) => Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
const centre = (b: Bounds): [number, number] => [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];

/** Metres of table per km of map so the longest side of `b` is `width` metres. */
export function tableScale(b: Bounds, width: number = MAP_TABLE.width): number {
  return width / span(b);
}

/** Two-hand scale limits (m per km) for a table between MAP_TABLE.minWidth and maxWidth. */
export function tableScaleLimits(b: Bounds): { min: number; max: number } {
  return { min: tableScale(b, MAP_TABLE.minWidth), max: tableScale(b, MAP_TABLE.maxWidth) };
}

/**
 * Table pose right in front of the head along its horizontal heading `yaw`, below eye level,
 * turned so that north points away from the user.
 */
export function tableInFront(head: Vec3, yaw: number, b: Bounds): MaquettePose {
  return {
    center: [head[0] + Math.sin(yaw) * MAP_TABLE.distance, Math.max(head[1] - MAP_TABLE.drop, MAP_TABLE.minHeight), head[2] + Math.cos(yaw) * MAP_TABLE.distance],
    yaw,
    scale: tableScale(b),
  };
}

/** Root transform for a pose: the map centre at sea level sits on the table centre. */
export function mapRootFromPose(b: Bounds, pose: MaquettePose, boost: number = MAP_TABLE.reliefBoost): MapRootTransform {
  const s = pose.scale;
  const [cx, cz] = centre(b);
  const [px, pz] = rotY([cx * s, cz * s], pose.yaw);
  return { scaling: [s, s * boost, s], yaw: pose.yaw, position: [pose.center[0] - px, pose.center[1], pose.center[2] - pz] };
}

/** Local map point (km) to world (m) through a root transform (same order as Babylon's TRS). */
export function mapToWorld(t: MapRootTransform, p: Vec3): Vec3 {
  const [x, z] = rotY([p[0] * t.scaling[0], p[2] * t.scaling[2]], t.yaw);
  return [x + t.position[0], p[1] * t.scaling[1] + t.position[1], z + t.position[2]];
}

/** A hand whose grip is held: grip position and heading in XR space. */
export interface GrabHand {
  id: string;
  position: Vec3;
  yaw: number;
}

type GrabStart =
  | { kind: 'one'; pose: MaquettePose; hand: GrabHand }
  | { kind: 'two'; pose: MaquettePose; a: GrabHand; b: GrabHand };

/**
 * Grip manipulation of the map table, frame by frame, with the simulator maquette's rules
 * (one hand: move and turn; two hands: scale, turn and move). Any change in the set of held
 * grips restarts the grab from the current pose, so going from one to two hands never jumps.
 */
export class TableGrab {
  private start: GrabStart | null = null;
  private key = '';

  get active(): boolean {
    return this.start !== null;
  }

  step(pose: MaquettePose, held: GrabHand[], limits: { min: number; max: number }): MaquettePose {
    const key = held.map((h) => h.id).sort().join('|');
    if (key !== this.key) {
      this.key = key;
      this.start = held.length === 1 ? { kind: 'one', pose: { ...pose }, hand: held[0] }
        : held.length >= 2 ? { kind: 'two', pose: { ...pose }, a: held[0], b: held[1] }
        : null;
      return pose;
    }
    const s = this.start;
    if (!s) return pose;
    if (s.kind === 'one') return grabOneHand(s.pose, { hand: s.hand.position, yaw: s.hand.yaw }, { hand: held[0].position, yaw: held[0].yaw });
    const a = held.find((h) => h.id === s.a.id) ?? held[0];
    const b = held.find((h) => h.id === s.b.id) ?? held[1];
    return grabTwoHands(s.pose, { a: s.a.position, b: s.b.position }, { a: a.position, b: b.position }, limits);
  }

  reset(): void {
    this.start = null;
    this.key = '';
  }
}
