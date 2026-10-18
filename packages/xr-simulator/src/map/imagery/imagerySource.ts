import { ancestorUv, parentOf, tileKey } from "../lod/quadtree";
import type { TileId } from "../tileMath";

/**
 * Satellite imagery layer (Phase 7, S7): sub-metre provider tiles requested DIRECTLY by the
 * browser, an explicit exception (decision L7) to "the client only queries our tiles API".
 * Our backend never proxies or caches them; only the browser's HTTP cache applies (provider
 * headers). Pure: URL building, provider choice, mosaic math, placeholder detection.
 *
 * Providers (VITE_IMAGERY_PROVIDER):
 * - `esri`: ArcGIS Location Platform World Imagery, authenticated with VITE_IMAGERY_KEY
 *   (`?token=`). Never falls back to the anonymous endpoint when the key is missing.
 * - `esri-prototipo` (default without a key): the public server.arcgisonline.com endpoint, as
 *   peru-simulator does. Outside Esri's terms; prototype/internal demo only, with a notice.
 * - `maptiler`, `google`: not implemented (documented stubs).
 * - `none`: no imagery.
 */

export type ImageryProviderId =
	| "esri"
	| "esri-prototipo"
	| "maptiler"
	| "google"
	| "none";
export type ImageryMode = "relief" | "satellite";

export interface ImageryEnv {
	VITE_IMAGERY_PROVIDER?: string;
	VITE_IMAGERY_KEY?: string;
}

export interface ImagerySource {
	provider: "esri" | "esri-prototipo";
	/** Highest provider zoom requested (real data: z19 in Lima/Cusco, z17 elsewhere; placeholders beyond). */
	maxZoom: number;
	/** Provider tile side (px). */
	tilePx: 256;
	/** Static data attribution (the service's copyrightText, 2026-10-18). */
	attribution: string;
	/** Esri requires "Powered by Esri" in apps that use its services. */
	poweredBy: string;
	/** Visible notice next to the attribution (prototype mode), else null. */
	notice: string | null;
	url(t: TileId): string;
	/** Service metadata (`?f=json`): dynamic copyrightText. */
	metadataUrl(): string;
}

export type ImageryAvailability =
	| { available: true; source: ImagerySource }
	| { available: false; provider: string; hint: string };

export const IMAGERY_HINTS = {
	noKey:
		"Imagen satelital: requiere una clave del proveedor (VITE_IMAGERY_KEY en .env.local)",
	none: "Imagen satelital desactivada (VITE_IMAGERY_PROVIDER=none)",
} as const;

export const PROTOTYPE_NOTICE =
	"Imagen satelital en modo prototipo (sin clave): uso fuera de los términos de Esri; no apto para producción";

/** Esri's "Map data not yet available" filler tile: always this size (and the same hash). */
export const ESRI_PLACEHOLDER_BYTES = 2521;

const ESRI_ATTRIBUTION =
	"Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community";
const ESRI_MAX_ZOOM = 19;
const ESRI_AUTH_BASE =
	"https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer";
const ESRI_PUBLIC_BASE =
	"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer";

function esri(
	provider: "esri" | "esri-prototipo",
	key: string | null,
): ImagerySource {
	const base = key ? ESRI_AUTH_BASE : ESRI_PUBLIC_BASE;
	const token = key ? encodeURIComponent(key) : null;
	return {
		provider,
		maxZoom: ESRI_MAX_ZOOM,
		tilePx: 256,
		attribution: ESRI_ATTRIBUTION,
		poweredBy: "Powered by Esri",
		notice: key ? null : PROTOTYPE_NOTICE,
		url: (t) =>
			`${base}/tile/${t.z}/${t.y}/${t.x}${token ? `?token=${token}` : ""}`,
		metadataUrl: () => `${base}?f=json${token ? `&token=${token}` : ""}`,
	};
}

/** Provider from the Vite env: explicit VITE_IMAGERY_PROVIDER, else `esri` with a key or `esri-prototipo` without. */
export function resolveImagery(env: ImageryEnv): ImageryAvailability {
	const key = env.VITE_IMAGERY_KEY?.trim() || null;
	const provider =
		env.VITE_IMAGERY_PROVIDER?.trim().toLowerCase() ||
		(key ? "esri" : "esri-prototipo");
	switch (provider) {
		case "esri":
			return key
				? { available: true, source: esri("esri", key) }
				: { available: false, provider, hint: IMAGERY_HINTS.noKey };
		case "esri-prototipo":
			// Explicitly keyless: a configured key is not sent to the public endpoint.
			return { available: true, source: esri("esri-prototipo", null) };
		case "none":
			return { available: false, provider, hint: IMAGERY_HINTS.none };
		case "maptiler":
		case "google":
			return {
				available: false,
				provider,
				hint: `Imagen satelital: proveedor «${provider}» no implementado`,
			};
		default:
			return {
				available: false,
				provider,
				hint: `Imagen satelital: proveedor «${provider}» desconocido (VITE_IMAGERY_PROVIDER)`,
			};
	}
}

/** What the attribution line and the notice show while imagery is visible. */
export function imageryCredit(
	source: ImagerySource,
	attribution = source.attribution,
): { text: string; notice: string | null } {
	return {
		text: `Imagen: ${attribution} · ${source.poweredBy}`,
		notice: source.notice,
	};
}

export type ImageryFetch = (
	url: string,
	init?: RequestInit,
) => Promise<Response>;

/** Dynamic attribution (the service's copyrightText); the static text on any failure. */
export async function fetchImageryAttribution(
	source: ImagerySource,
	fetchFn: ImageryFetch = fetch,
): Promise<string> {
	try {
		const res = await fetchFn(source.metadataUrl(), { mode: "cors" });
		if (!res.ok) return source.attribution;
		const meta = (await res.json()) as { copyrightText?: unknown };
		return typeof meta.copyrightText === "string" && meta.copyrightText.trim()
			? meta.copyrightText.trim()
			: source.attribution;
	} catch {
		return source.attribution;
	}
}

/** Imagery texture side per quadtree tile: 512 (2×2 provider tiles, desktop) or 256 (one tile, Quest). */
export type ImageryTexturePx = 512 | 256;

/** Deepest quadtree level whose mosaic stays within the provider's max zoom. */
export function imageryQuadMaxZoom(
	providerMaxZoom: number,
	texturePx: ImageryTexturePx,
): number {
	return texturePx === 512 ? providerMaxZoom - 1 : providerMaxZoom;
}

export interface ImageryPlan {
	/** Texture side (px). */
	size: number;
	/** Provider tiles and where they go in the texture (px, row 0 = north). */
	parts: { tile: TileId; x: number; y: number }[];
}

/** Provider tiles covering one quadtree tile: z+1 2×2 (NW, NE, SW, SE) at 512 px, or z itself at 256 px. */
export function imageryPlan(
	t: TileId,
	texturePx: ImageryTexturePx,
	providerMaxZoom: number,
): ImageryPlan {
	if (t.z > imageryQuadMaxZoom(providerMaxZoom, texturePx))
		throw new Error(
			`imagen satelital: z${t.z} supera el zoom máximo del proveedor`,
		);
	if (texturePx === 256)
		return { size: 256, parts: [{ tile: { ...t }, x: 0, y: 0 }] };
	const parts: ImageryPlan["parts"] = [];
	for (const [dx, dy] of [
		[0, 0],
		[1, 0],
		[0, 1],
		[1, 1],
	])
		parts.push({
			tile: { z: t.z + 1, x: 2 * t.x + dx, y: 2 * t.y + dy },
			x: dx * 256,
			y: dy * 256,
		});
	return { size: 512, parts };
}

export type ImageryParts =
	| {
			kind: "ready";
			size: number;
			parts: { bitmap: ImageBitmap; x: number; y: number }[];
	  }
	/** No real imagery there (placeholder or 404): the tile falls back to its ancestor's imagery. */
	| { kind: "unavailable" };

export type ImageryDecode = (blob: Blob) => Promise<ImageBitmap>;

/** createImageBitmap decodes off the main thread. */
export const decodeImagery: ImageryDecode = (blob) => createImageBitmap(blob);

/**
 * Downloads and decodes every provider tile of a plan. Errors never carry the URL (it holds
 * the key): only the HTTP status or a generic network message.
 */
export async function loadImageryParts(
	source: ImagerySource,
	plan: ImageryPlan,
	signal: AbortSignal,
	fetchFn: ImageryFetch = fetch,
	decode: ImageryDecode = decodeImagery,
): Promise<ImageryParts> {
	const one = async (t: TileId): Promise<ImageBitmap | null> => {
		let res: Response;
		try {
			res = await fetchFn(source.url(t), {
				signal,
				mode: "cors",
				credentials: "omit",
			});
		} catch {
			if (signal.aborted) throw new DOMException("Aborted", "AbortError");
			throw new Error("imagen satelital: error de red");
		}
		if (res.status === 404) return null;
		if (!res.ok) throw new Error(`imagen satelital: HTTP ${res.status}`);
		if (!(res.headers.get("Content-Type") ?? "").startsWith("image/"))
			throw new Error("imagen satelital: la respuesta no es una imagen");
		const blob = await res.blob();
		if (blob.size === ESRI_PLACEHOLDER_BYTES) return null;
		return decode(blob);
	};
	const settled = await Promise.allSettled(plan.parts.map((p) => one(p.tile)));
	const bitmaps = settled.map((s) =>
		s.status === "fulfilled" ? s.value : null,
	);
	const closeAll = () =>
		bitmaps.forEach((b) => {
			b?.close();
		});
	const failure = settled.find(
		(s): s is PromiseRejectedResult => s.status === "rejected",
	);
	if (failure) {
		closeAll();
		throw failure.reason;
	}
	if (bitmaps.some((b) => b === null)) {
		closeAll();
		return { kind: "unavailable" };
	}
	return {
		kind: "ready",
		size: plan.size,
		parts: plan.parts.map((p, i) => ({ bitmap: bitmaps[i]!, x: p.x, y: p.y })),
	};
}

export interface ImageryBinding {
	key: string;
	offsetU: number;
	offsetV: number;
	scale: number;
}

/** Imagery a displayed tile draws: its own when ready, else the nearest ready ancestor's sub-rectangle. */
export function imageryBinding(
	t: TileId,
	hasImagery: (key: string) => boolean,
): ImageryBinding | null {
	for (let a: TileId | null = t; a; a = parentOf(a)) {
		const key = tileKey(a);
		if (hasImagery(key)) {
			const uv = ancestorUv(t, a);
			return { key, offsetU: uv.offsetU, offsetV: uv.offsetV, scale: uv.scale };
		}
	}
	return null;
}
