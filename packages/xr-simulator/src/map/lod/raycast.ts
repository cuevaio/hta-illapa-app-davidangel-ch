import type { Vec3 } from "./quadtree";

/**
 * First point where a ray goes below the ground `groundAt(x, z)` (scene units), or null.
 * Marches with steps proportional to the height above ground (min `minStep`), then bisects.
 * Pure: the streamed relief has no CPU mesh to pick against.
 */
export function raycastGround(
	origin: Vec3,
	direction: Vec3,
	groundAt: (x: number, z: number) => number,
	maxDistance: number,
	minStep = 0.02,
): Vec3 | null {
	const len = Math.hypot(...direction);
	if (len === 0) return null;
	const d: Vec3 = [direction[0] / len, direction[1] / len, direction[2] / len];
	const at = (t: number): Vec3 => [
		origin[0] + d[0] * t,
		origin[1] + d[1] * t,
		origin[2] + d[2] * t,
	];
	const above = (t: number) => {
		const p = at(t);
		return p[1] - groundAt(p[0], p[2]);
	};
	let t0 = 0;
	let h0 = above(0);
	if (h0 <= 0) return at(0);
	for (let i = 0; i < 4000 && t0 < maxDistance; i++) {
		const t1 = Math.min(maxDistance, t0 + Math.max(minStep, h0 * 0.25));
		const h1 = above(t1);
		if (h1 <= 0) {
			let lo = t0;
			let hi = t1;
			for (let k = 0; k < 30; k++) {
				const mid = (lo + hi) / 2;
				if (above(mid) > 0) lo = mid;
				else hi = mid;
			}
			return at(hi);
		}
		t0 = t1;
		h0 = h1;
	}
	return null;
}
