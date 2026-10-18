import type {
	Error as ApiError,
	Capa,
	Capas,
	Fuente,
	TileMetadata,
	VersionCapa,
} from "@hack-the-andes-project/tiles-schema/types";
import { decodeTerrarium } from "./terrarium";
import { TILE_PX, type TileId } from "./tileMath";

/** Spanish notice shown when the tiles service does not answer (the simulator still starts). */
export const TILES_DOWN_NOTICE =
	"No se pudo cargar el mapa del Perú: el servicio de tiles no responde (docker compose up)";
/** Used when `GET /capas` gives no attribution for the terrain layer. */
export const DEFAULT_ATTRIBUTION =
	"Terreno: Terrain Tiles on AWS (Mapzen/Tilezen y proveedores; SRTM, GMTED)";
export const TERRAIN_LAYER = "terreno";
export const TERRAIN_VERSION = "v1";

/** The service is unreachable (network error, timeout or proxy 502/503/504). */
export class TilesUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TilesUnavailableError";
	}
}

/** A tile's metadata as read from its `X-Tile-*` headers (fields of the shared `TileMetadata`). */
export interface TileMeta {
	min: TileMetadata["min"];
	max: TileMetadata["max"];
	/** X-Tile-Source (`fuente`). */
	source: TileMetadata["fuente"] | null;
	version: TileMetadata["version"] | null;
	/** X-Tile-Date (`fecha`). */
	date: TileMetadata["fecha"] | null;
	/** X-Tile-Overzoom = 1 (`sobremuestreo`). */
	overzoom: TileMetadata["sobremuestreo"];
	/** X-Cache (not part of the stored metadata). */
	cache: string | null;
}

export interface DecodedTile {
	id: TileId;
	size: number;
	/** Row 0 = north; nodata = NaN. */
	heights: Float32Array;
	meta: TileMeta;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
export type DecodeFn = (
	blob: Blob,
) => Promise<{ width: number; height: number; rgba: ArrayLike<number> }>;

/** Base URL of our tiles API: `/tiles-api` (Vite proxy) unless `VITE_TILES_URL` overrides it. */
export function tilesBaseUrl(
	env: { VITE_TILES_URL?: string } = import.meta.env as {
		VITE_TILES_URL?: string;
	},
): string {
	const v = env.VITE_TILES_URL?.trim();
	return (v ? v : "/tiles-api").replace(/\/+$/, "");
}

/** Exact RGB decode of a PNG: no colour-space conversion or premultiplication. */
export const decodePng: DecodeFn = async (blob) => {
	const bmp = await createImageBitmap(blob, {
		colorSpaceConversion: "none",
		premultiplyAlpha: "none",
	});
	const canvas = new OffscreenCanvas(bmp.width, bmp.height);
	const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
	ctx.drawImage(bmp, 0, 0);
	bmp.close();
	return {
		width: canvas.width,
		height: canvas.height,
		rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
	};
};

const num = (v: string | null) =>
	v === null || v === "" || Number.isNaN(Number(v)) ? null : Number(v);

/** Client for our tiles API (the browser never calls upstream sources directly). */
export class TilesClient {
	constructor(
		readonly base = tilesBaseUrl(),
		private readonly fetchFn: FetchFn = (u, i) => fetch(u, i),
		private readonly decode: DecodeFn = decodePng,
		private readonly credentials: RequestCredentials = "same-origin",
	) {}

	private async get(
		path: string,
		timeoutMs: number,
		signal?: AbortSignal,
	): Promise<Response> {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), timeoutMs);
		const onAbort = () => ctrl.abort();
		signal?.addEventListener("abort", onAbort, { once: true });
		let res: Response;
		try {
			res = await this.fetchFn(`${this.base}${path}`, {
				signal: ctrl.signal,
				credentials: this.credentials,
			});
		} catch (err) {
			// A caller's cancellation is not an outage.
			if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
			throw new TilesUnavailableError(`${path}: ${String(err)}`);
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		}
		// The Vite proxy answers 502/504 when the backend is down.
		if (res.status === 502 || res.status === 503 || res.status === 504)
			throw new TilesUnavailableError(`${path}: HTTP ${res.status}`);
		return res;
	}

	/** `GET /salud`; throws TilesUnavailableError unless the service answers 2xx. */
	async health(timeoutMs = 4000): Promise<void> {
		const res = await this.get("/salud", timeoutMs);
		if (!res.ok) throw new TilesUnavailableError(`/salud: HTTP ${res.status}`);
	}

	/** `GET /capas`, or null when unavailable or not shaped as `Capas`. */
	async layers(timeoutMs = 4000): Promise<Capas | null> {
		try {
			const res = await this.get("/capas", timeoutMs);
			const body: unknown = res.ok ? await res.json() : null;
			return isCapas(body) ? body : null;
		} catch {
			return null;
		}
	}

	/** Raw bytes and metadata of one terrain tile, cancellable; a 404 (outside Peru) resolves to null. */
	async tileBytes(
		id: TileId,
		signal?: AbortSignal,
		layer = TERRAIN_LAYER,
		version = TERRAIN_VERSION,
		timeoutMs = 30000,
	): Promise<{ buffer: ArrayBuffer; meta: TileMeta } | null> {
		const res = await this.get(
			`/tiles/${layer}/${version}/${id.z}/${id.x}/${id.y}`,
			timeoutMs,
			signal,
		);
		if (res.status === 404) return null;
		if (!res.ok) {
			const body = (await res
				.json()
				.catch(() => null)) as Partial<ApiError> | null;
			throw new Error(
				`Tile ${id.z}/${id.x}/${id.y}: ${body?.error ?? `HTTP ${res.status}`}`,
			);
		}
		return { buffer: await res.arrayBuffer(), meta: metaFrom(res.headers) };
	}

	/** One terrain tile; a 404 (outside Peru) resolves to null. */
	async tile(
		id: TileId,
		layer = TERRAIN_LAYER,
		version = TERRAIN_VERSION,
		timeoutMs = 20000,
	): Promise<DecodedTile | null> {
		const res = await this.get(
			`/tiles/${layer}/${version}/${id.z}/${id.x}/${id.y}`,
			timeoutMs,
		);
		if (res.status === 404) return null;
		if (!res.ok) {
			const body = (await res
				.json()
				.catch(() => null)) as Partial<ApiError> | null;
			throw new Error(
				`Tile ${id.z}/${id.x}/${id.y}: ${body?.error ?? `HTTP ${res.status}`}`,
			);
		}
		const img = await this.decode(await res.blob());
		return {
			id,
			size: img.width,
			heights: decodeTerrarium(img.rgba, img.width, img.height),
			meta: metaFrom(res.headers),
		};
	}
}

function metaFrom(hd: Headers): TileMeta {
	return {
		min: num(hd.get("X-Tile-Min")),
		max: num(hd.get("X-Tile-Max")),
		source: hd.get("X-Tile-Source"),
		version: hd.get("X-Tile-Version"),
		date: hd.get("X-Tile-Date"),
		overzoom: hd.get("X-Tile-Overzoom") === "1",
		cache: hd.get("X-Cache"),
	};
}

/** Fetches tiles with bounded concurrency, reporting progress. */
export async function fetchTiles(
	client: TilesClient,
	ids: TileId[],
	onProgress?: (done: number, total: number) => void,
	concurrency = 6,
): Promise<(DecodedTile | null)[]> {
	const out: (DecodedTile | null)[] = new Array(ids.length).fill(null);
	let next = 0;
	let done = 0;
	const worker = async () => {
		while (next < ids.length) {
			const k = next++;
			out[k] = await client.tile(ids[k]);
			onProgress?.(++done, ids.length);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(concurrency, ids.length) }, worker),
	);
	return out;
}

/** Minimal runtime check of an untrusted `GET /capas` body before typed access. */
export function isCapas(v: unknown): v is Capas {
	return !!v && typeof v === "object" && Array.isArray((v as Capas).capas);
}

/**
 * Terrain attribution from `GET /capas` (shape: packages/tiles-schema `Capas`): the source of
 * the current version, `Terreno: <fuente.nombre>. <fuente.atribucion>`; null when absent.
 */
export function attributionFrom(capas: unknown): string | null {
	if (!isCapas(capas)) return null;
	const layer: Capa | undefined = capas.capas.find(
		(c) => c?.id === TERRAIN_LAYER,
	);
	if (!layer || !Array.isArray(layer.versiones)) return null;
	const current: VersionCapa | undefined =
		layer.versiones.find((v) => v?.version === layer.version_actual) ??
		layer.versiones[0];
	const src: Fuente | undefined = current?.fuente;
	const text = typeof src?.atribucion === "string" ? src.atribucion.trim() : "";
	if (!text) return null;
	return `Terreno: ${typeof src?.nombre === "string" && src.nombre.trim() ? `${src.nombre.trim()}. ` : ""}${text}`;
}

export type OverviewLoad = { ok: true } | { ok: false; error: unknown };

/** What the app shows first: the Peru overview, or (as before this feature) the synthetic simulator with a notice. */
export function startScreen(load: OverviewLoad): {
	screen: "overview" | "simulator";
	notice: string | null;
} {
	if (load.ok) return { screen: "overview", notice: null };
	if (load.error instanceof TilesUnavailableError)
		return { screen: "simulator", notice: TILES_DOWN_NOTICE };
	const msg =
		load.error instanceof Error ? load.error.message : String(load.error);
	return {
		screen: "simulator",
		notice: `No se pudo cargar el mapa del Perú: ${msg}`,
	};
}

export { TILE_PX };
