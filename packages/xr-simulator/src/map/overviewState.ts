/** Pure overview UI rules (src/map/PeruOverview.ts). */
import { type LocalFrame, worldToLocal } from "./lod/quadtree";
import { lonLatToWorld } from "./tileMath";

/** Vertical exaggeration slider (as peru-simulator: default ×3, range 1–10). Shared by web and VR. */
export const EXAGGERATION = { default: 3, min: 1, max: 10, step: 0.5 } as const;

const fmt = (v: number, d: number) =>
	v.toLocaleString("es", {
		maximumFractionDigits: d,
		minimumFractionDigits: d,
	});

/** Picked point text (web pick info and the VR "Simular aquí" card). */
export function pointLabel(p: {
	lon: number;
	lat: number;
	height: number | null;
}): string {
	return `Lon ${fmt(p.lon, 4)} · Lat ${fmt(p.lat, 4)} · Cota ${p.height === null ? "sin datos" : `${fmt(p.height, 0)} m`}`;
}

export function exaggerationLabel(v: number): string {
	return `×${v.toLocaleString("es", { maximumFractionDigits: 1 })}`;
}

/**
 * Enabled state of the overview actions. Both go to the simulator, so they wait until it is
 * built (A1); "Simular aquí" also needs a picked point and the relief, and neither runs
 * while a "Simular aquí" download is in progress.
 */
export function overviewButtons(s: {
	loaded: boolean;
	picked: boolean;
	busy: boolean;
	simulatorReady: boolean;
}): { simulate: boolean; skip: boolean } {
	return {
		simulate: s.simulatorReady && s.loaded && s.picked && !s.busy,
		skip: s.simulatorReady && !s.busy,
	};
}

/** Label of "Ir al simulador": re-entering the active "Simular aquí" simulation when there is one. */
export function skipLabel(activeLabel: string | null): string {
	return activeLabel
		? `Volver a la simulación (${activeLabel})`
		: "Ir al simulador";
}

/**
 * Overview marker of the active simulation: scene km position, exaggerated ground (km) at
 * its elevation `heightM` (sea and unknown read 0 m) and the patch side (km).
 */
export function activeSiteMarker(
	frame: LocalFrame,
	site: { lon: number; lat: number; size: number },
	exaggeration: number,
	heightM: number | null,
): { x: number; z: number; ground: number; footprint: number } {
	const w = lonLatToWorld(site.lon, site.lat);
	const [x, z] = worldToLocal(frame, w.x, w.y);
	return {
		x,
		z,
		ground: (Math.max(heightM ?? 0, 0) / 1000) * exaggeration,
		footprint: site.size / 1000,
	};
}
