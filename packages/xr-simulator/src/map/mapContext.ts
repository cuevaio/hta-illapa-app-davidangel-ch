import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { LocalFrame } from "./lod/quadtree";
import type { TerrainLook } from "./lod/terrainMaterial";
import type { Hole } from "./lod/terrainRenderer";
import { lonLatToWorld, metresPerWorldUnit, worldToLonLat } from "./tileMath";

/**
 * Map context of a "Simular aquí" simulation (S1), pure rules; drawn by MapContextView.
 * The streamed Peru relief (LodTerrain, scene km) is drawn in the simulator scene as a child
 * of the terrain root (metres, origin at the grid corner, x east, z north): a node at the
 * patch centre scaled by CONTEXT_SCALE turns context km into root metres, and the context
 * frame is centred on the site with buildLocalGrid's own scale (1/cos(lat) of the centre),
 * so every patch cell lands on the same z11 point it was sampled from.
 */

/** Ground location of a simulated terrain (the "Simular aquí" point = patch centre). */
export interface MapSite {
	lon: number;
	lat: number;
}

/** Root metres per context km. */
export const CONTEXT_SCALE = 1000;
/**
 * Vertical scale of the context: ×1, the simulator's own scale. The solver, the walls and
 * the flow are true-scale metres (and the XR maquette scales the root uniformly), so the
 * relief around them is too; the overview's ×3 is a country-scale reading aid only.
 */
export const CONTEXT_EXAGGERATION = 1;
/** Same sky as the simulator scene's clear colour (src/render/World.ts) and the overview. */
const CONTEXT_FOG = new Color3(0.62, 0.7, 0.78);
/** EXP2 fog per root metre: negligible over the patch, ~60 % at 300 km. */
const CONTEXT_FOG_DENSITY = 3e-6;
/** Hillshade slope factor: the overview uses 5 at country scale; nearer views need less. */
const CONTEXT_HILLSHADE_Z = 2;
/** While the flow runs, the context refines at twice the profile's SSE (keeps the solver's frame rate). */
const SIMULATING_SSE_SCALE = 2;
/** Orbit reach with a context: far enough to see the valley system around the patch. */
const CONTEXT_MAX_RADIUS = 150_000;
const CONTEXT_MAX_Z = 600_000;
/** As before without a context (src/render/World.ts fitTerrain). */
const PATCH_RADIUS_FACTOR = 6;
const PATCH_MAX_Z = 50_000;

/** Context frame: origin at the site, scene km at the site's latitude (as buildLocalGrid). */
export function contextFrame(site: MapSite): LocalFrame {
	const o = lonLatToWorld(site.lon, site.lat);
	return { ox: o.x, oy: o.y, k: metresPerWorldUnit(site.lat) / 1000 };
}

/** Lon/lat of the simulator terrain-local point (x east, z north; metres from the grid corner). */
export function patchToLonLat(
	site: MapSite,
	size: number,
	x: number,
	z: number,
): { lon: number; lat: number } {
	const o = lonLatToWorld(site.lon, site.lat);
	const m = metresPerWorldUnit(site.lat);
	return worldToLonLat(o.x + (x - size / 2) / m, o.y - (z - size / 2) / m);
}

export function lonLatToPatch(
	site: MapSite,
	size: number,
	lon: number,
	lat: number,
): [number, number] {
	const o = lonLatToWorld(site.lon, site.lat);
	const w = lonLatToWorld(lon, lat);
	const m = metresPerWorldUnit(site.lat);
	return [(w.x - o.x) * m + size / 2, -(w.y - o.y) * m + size / 2];
}

/** Context local km of a terrain-local point. */
export function patchToContext(
	size: number,
	x: number,
	z: number,
): [number, number] {
	return [(x - size / 2) / CONTEXT_SCALE, (z - size / 2) / CONTEXT_SCALE];
}

/** Root-local position of the context node (scaled by CONTEXT_SCALE). */
export function contextNodePosition(size: number): [number, number, number] {
	return [size / 2, 0, size / 2];
}

/** Root metres of a context height (scene km, already exaggerated). */
export function contextToRootY(km: number): number {
	return km * CONTEXT_SCALE;
}

/** The patch mesh spans the cell centres; the context draws nothing there (context km). */
export function patchHole(t: { size: number; cellSize: number }): Hole {
	const half = (t.size / 2 - t.cellSize / 2) / CONTEXT_SCALE;
	return [-half, -half, half, half];
}

export function contextLook(): TerrainLook {
	return {
		exaggeration: CONTEXT_EXAGGERATION,
		fogColor: CONTEXT_FOG,
		fogDensity: CONTEXT_FOG_DENSITY,
		hillshadeZ: CONTEXT_HILLSHADE_Z,
	};
}

export function contextSseScale(simulating: boolean): number {
	return simulating ? SIMULATING_SSE_SCALE : 1;
}

/** Orbit limits of the simulator camera: as before without a context, wider with one. */
export function contextCamera(
	size: number,
	hasContext: boolean,
): { upperRadiusLimit: number; maxZ: number } {
	const patch = size * PATCH_RADIUS_FACTOR;
	if (!hasContext) return { upperRadiusLimit: patch, maxZ: PATCH_MAX_Z };
	return {
		upperRadiusLimit: Math.max(patch, CONTEXT_MAX_RADIUS),
		maxZ: CONTEXT_MAX_Z,
	};
}

/** Only "Simular aquí" terrains have a real location; the synthetic ravine and DEM files do not. */
export function mapSiteOf(
	source: { kind: "synthetic" } | { kind: "dem"; site?: MapSite },
): MapSite | null {
	return source.kind === "dem" && source.site
		? { lon: source.site.lon, lat: source.site.lat }
		: null;
}

/** HUD line of the context state. */
export function contextBadge(site: MapSite | null): string {
	return site
		? `Contexto: relieve del Perú alrededor (escala vertical ×${CONTEXT_EXAGGERATION})`
		: "Sin contexto de mapa (terreno sin ubicación real)";
}
