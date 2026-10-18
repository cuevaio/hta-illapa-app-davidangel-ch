import { FOG_DENSITY_PER_KM, FOG_MAX_OPTICAL_DEPTH } from "./constants";

/**
 * Fog density (per km) for a view `viewKm` away from the ground it looks at (the orbit radius,
 * or the eye height above the relief in flight): the near density up close, then capped so the
 * fog at that distance never passes FOG_MAX_OPTICAL_DEPTH.
 */
export function fogDensityAt(viewKm: number): number {
	return Math.min(
		FOG_DENSITY_PER_KM,
		FOG_MAX_OPTICAL_DEPTH / Math.max(viewKm, 1),
	);
}
