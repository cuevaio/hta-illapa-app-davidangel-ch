import { EARTH_CIRCUMFERENCE } from "../tileMath";
import type { WorldRect } from "./grid";
import type { Region } from "./wind";

/**
 * Region of the wind-trail / lightning overlay (S8): a square in the Web Mercator unit square
 * that follows the view footprint, so density and streak width stay similar at every zoom
 * (after peru-simulator's chooseTrailRect). It changes only when the footprint leaves it or
 * becomes much smaller (hysteresis: each change restarts the trails). Pure.
 */

const PAD = 1.1;
const MARGIN = 1.35;
const SHRINK = 0.35;

/** `need`: side (world units) the view needs around `centre`. */
export function chooseRegion(
	current: Region | null,
	centre: { x: number; y: number },
	need: number,
	grid: WorldRect,
): Region {
	const maxSide = Math.max(grid.w, grid.h);
	const side = Math.min(maxSide, need * PAD);
	if (current) {
		const h = side / 2;
		const fits =
			centre.x - h >= current.x0 &&
			centre.y - h >= current.y0 &&
			centre.x + h <= current.x0 + current.side &&
			centre.y + h <= current.y0 + current.side;
		if (
			(fits && side >= current.side * SHRINK) ||
			(current.side >= maxSide - 1e-12 && side >= maxSide * SHRINK)
		)
			return current;
	}
	const s = Math.min(maxSide, side * MARGIN);
	const clampAxis = (c: number, o: number, len: number) => {
		const x0 = c - s / 2;
		// A region larger than the grid keeps the grid inside; a smaller one keeps its centre over it.
		return s >= len
			? Math.min(o, Math.max(o + len - s, x0))
			: Math.min(o + len - s / 2, Math.max(o - s / 2, x0));
	};
	return {
		x0: clampAxis(centre.x, grid.x0, grid.w),
		y0: clampAxis(centre.y, grid.y0, grid.h),
		side: s,
	};
}

/** Ground metres across a region at its centre latitude. */
export function regionMeters(r: Region): number {
	const yc = r.y0 + r.side / 2;
	const lat = 2 * Math.atan(Math.exp(Math.PI * (1 - 2 * yc))) - Math.PI / 2;
	return r.side * EARTH_CIRCUMFERENCE * Math.cos(lat);
}

/**
 * What the view needs (local km frame of the terrain, y up): where the gaze meets the ground
 * plane (or a point ahead when it looks above the horizon) and a side of ~2.5× that distance.
 */
export function viewFocus(
	eye: [number, number, number],
	dir: [number, number, number],
	groundKm: number,
): { x: number; z: number; sideKm: number } {
	const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
	const d = [dir[0] / len, dir[1] / len, dir[2] / len];
	const height = Math.max(0.05, eye[1] - groundKm);
	const t = d[1] < -0.05 ? Math.min(height / -d[1], height * 20) : height * 3;
	return {
		x: eye[0] + d[0] * t,
		z: eye[2] + d[2] * t,
		sideKm: Math.max(30, 2.5 * Math.hypot(t * d[0], height, t * d[2])),
	};
}
