import { lonLatToMercator, mercatorToLonLat } from "./tile-math";
import type { LonLat } from "./types";

/**
 * Local metric frame: Web Mercator meters relative to an origin, scaled by
 * cos(originLat) so that distances are true meters near the origin.
 * Axes follow Three.js conventions: +x east, +y up, -z north.
 */
export interface LocalFrame {
	readonly originX: number;
	readonly originY: number;
	/** Local units per mercator meter. */
	readonly scale: number;
}

import { RADIANS_PER_DEG } from "../constants";

export function createLocalFrame(
	originLon: number,
	originLat: number,
): LocalFrame {
	const mercator = lonLatToMercator(originLon, originLat);
	return {
		originX: mercator.x,
		originY: mercator.y,
		scale: Math.cos(originLat * RADIANS_PER_DEG),
	};
}

export function mercatorToLocal(
	frame: LocalFrame,
	mercatorX: number,
	mercatorY: number,
): { x: number; z: number } {
	return {
		x: (mercatorX - frame.originX) * frame.scale,
		z: -(mercatorY - frame.originY) * frame.scale,
	};
}

export function localToMercator(
	frame: LocalFrame,
	x: number,
	z: number,
): { x: number; y: number } {
	return {
		x: x / frame.scale + frame.originX,
		y: -z / frame.scale + frame.originY,
	};
}

export function lonLatToLocal(
	frame: LocalFrame,
	lon: number,
	lat: number,
): { x: number; z: number } {
	const mercator = lonLatToMercator(lon, lat);
	return mercatorToLocal(frame, mercator.x, mercator.y);
}

export function localToLonLat(frame: LocalFrame, x: number, z: number): LonLat {
	const mercator = localToMercator(frame, x, z);
	return mercatorToLonLat(mercator.x, mercator.y);
}
