import type { Ray, Vec3 } from './pointer';

/** Height field queried by the raycast (terrain-local metres). */
export interface HeightField {
  /** Domain extent along x and z (m). */
  readonly size: number;
  readonly cellSize: number;
  heightAt(x: number, z: number): number;
  minMax(): [number, number];
}

export interface RayHit {
  point: Vec3;
  /** Ray parameter (distance along a normalised ray). */
  t: number;
}

/**
 * Ray marching over the CPU copy of the terrain with bisection refinement.
 * The ray must be in terrain-local coordinates. Returns null on a miss.
 */
export function raycastHeightField(field: HeightField, ray: Ray, bisectionSteps = 24): RayHit | null {
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.direction;
  const [lo, hi] = field.minMax();
  // Clip the ray against the field's bounding box (slab method).
  let t0 = 0;
  let t1 = Infinity;
  const slabs: [number, number, number, number][] = [
    [ox, dx, 0, field.size],
    [oy, dy, lo - 1, hi + 1],
    [oz, dz, 0, field.size],
  ];
  for (const [o, d, min, max] of slabs) {
    if (Math.abs(d) < 1e-12) {
      if (o < min || o > max) return null;
      continue;
    }
    let a = (min - o) / d;
    let b = (max - o) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  const above = (t: number) => oy + dy * t - field.heightAt(ox + dx * t, oz + dz * t);
  // Step of half a cell measured along the horizontal projection.
  const horiz = Math.hypot(dx, dz);
  const step = horiz > 1e-6 ? (0.5 * field.cellSize) / horiz : (hi - lo + 2) / 8;
  let prevT = t0;
  let prevF = above(t0);
  if (prevF <= 0) return { point: [ox + dx * t0, oy + dy * t0, oz + dz * t0], t: t0 };
  for (let t = t0 + step; prevT < t1; t += step) {
    const tc = Math.min(t, t1);
    const f = above(tc);
    if (f <= 0) {
      let a = prevT;
      let b = tc;
      for (let k = 0; k < bisectionSteps; k++) {
        const m = 0.5 * (a + b);
        if (above(m) > 0) a = m;
        else b = m;
      }
      const th = 0.5 * (a + b);
      return { point: [ox + dx * th, oy + dy * th, oz + dz * th], t: th };
    }
    prevT = tc;
    prevF = f;
  }
  return null;
}
