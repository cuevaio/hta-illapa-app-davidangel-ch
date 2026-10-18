import {
	BaseTexture,
	type Camera,
	Frustum,
	type Matrix,
	type Scene,
	Texture,
	type TransformNode,
	Vector3,
} from "@babylonjs/core";
import {
	type ImageryParts,
	type ImagerySource,
	imageryPlan,
	imageryQuadMaxZoom,
	loadImageryParts,
} from "../imagery/imagerySource";
import {
	MAX_REAL_ZOOM,
	PERU_BBOX,
	type TileId,
	tilesCovering,
} from "../tileMath";
import type { TilesClient } from "../tilesClient";
import { DecoderPool } from "./decoderPool";
import { FrameBudget } from "./frameBudget";
import { createHeightTexture } from "./heightTexture";
import {
	type Plane,
	planesFrustum,
	selectTiles,
	type TileRequest,
} from "./lod";
import type { LodProfile } from "./lodProfile";
import {
	childrenOf,
	type LocalFrame,
	parentOf,
	parseTileKey,
	tileKey,
	type Vec3,
} from "./quadtree";
import type { TerrainLook } from "./terrainMaterial";
import {
	type HeightSource,
	type HeightTile,
	type Hole,
	TerrainRenderer,
	type TerrainWeather,
} from "./terrainRenderer";
import { TerrainSampler } from "./terrainSampler";
import { flatTile, type PreparedTile, TileSurface } from "./tileData";
import { rootsReadiness, TileLayer } from "./tileLayer";

/** Quadtree roots: 6 tiles of 512 px (~2.4 km/px) cover the Peru bbox; prewarmed by the backend. */
export const ROOT_ZOOM = 5;
/** Real data only (z12–z14 are overzoom): never requested by default. */
export const LOD_MAX_ZOOM = MAX_REAL_ZOOM;
/** Highest relief (m) used for tiles whose own range is not known yet (Huascarán 6 768 m). */
const PERU_MAX_HEIGHT = 6800;
/**
 * Imagery-only levels (past LOD_MAX_ZOOM) refine once one imagery texel would cover more than
 * this many px: they add no relief (heights are the z11 ancestor's, interpolated), only detail.
 */
export const IMAGERY_TEXEL_SSE = 1;

/**
 * Quadtree limits with the Satélite shading: refine past the terrain's real max z11 up to the
 * provider's max zoom (mosaic level included), by imagery texel size on those levels. Terrain
 * tiles past z11 are never requested: those levels reuse the z11 ancestor's heights.
 */
export function imageryLodParams(
	profile: LodProfile,
	providerMaxZoom: number,
): { maxZoom: number; thresholdScale: (t: TileId) => number } {
	const maxZoom = Math.max(
		LOD_MAX_ZOOM,
		imageryQuadMaxZoom(providerMaxZoom, profile.imageryPx),
	);
	const scale =
		(IMAGERY_TEXEL_SSE * profile.imageryPx) /
		profile.segments /
		profile.maxScreenSpaceError;
	return { maxZoom, thresholdScale: (t) => (t.z >= LOD_MAX_ZOOM ? scale : 1) };
}

/** A loaded imagery tile: texture, or null where the provider has no real imagery (placeholder/404). */
export interface ImageryTile {
	texture: BaseTexture | null;
	dispose(): void;
}

/** What the LOD needs from the active camera(s): one entry per eye in XR. */
export interface LodView {
	position: Vec3;
	frusta: Plane[][];
	/** Pixels per km of error at 1 km (CSS-like px on the web, eye-buffer px in XR). */
	sseFactor: number;
	/** Changes whenever the view or viewport changes (cheap change detection). */
	signature: number[];
}

/**
 * LOD view of a Babylon camera: its rig cameras in XR (both eyes), else the camera itself.
 * `pixelHeight` is the viewport height in px the SSE is measured in. `world` (map context):
 * the terrain's world matrix (uniform scale); the view is then expressed in its local km.
 */
export function viewOf(
	camera: Camera,
	pixelHeight: number,
	world: Matrix | null = null,
): LodView {
	const cams = camera.rigCameras.length ? camera.rigCameras : [camera];
	const frusta: Plane[][] = [];
	const signature: number[] = [pixelHeight];
	let sseFactor = 0;
	for (const c of cams) {
		const m = world
			? world.multiply(c.getTransformationMatrix())
			: c.getTransformationMatrix();
		frusta.push(
			Frustum.GetPlanes(m).map(
				(p) => [p.normal.x, p.normal.y, p.normal.z, p.d] as Plane,
			),
		);
		signature.push(...m.m);
		// m[5] = 1 / tan(fovY / 2); the error/distance ratio is unchanged by a uniform scale.
		sseFactor = Math.max(
			sseFactor,
			(pixelHeight * c.viewport.height * c.getProjectionMatrix().m[5]) / 2,
		);
	}
	const g = camera.globalPosition;
	const p = world ? Vector3.TransformCoordinates(g, world.clone().invert()) : g;
	return { position: [p.x, p.y, p.z], frusta, sseFactor, signature };
}

/** Map-context options (src/map/MapContext.ts); the overview passes none. */
export interface LodContextOptions {
	/** The tiles follow this node (the simulator root). */
	parent: TransformNode;
}

export interface LodStats {
	drawn: number;
	inFlight: number;
	queued: number;
	cached: number;
	maxZoom: number;
	waitingUpload: number;
	/** Imagery layer (null with the Relieve shading). */
	imagery: {
		inFlight: number;
		queued: number;
		cached: number;
		capacity: number;
	} | null;
}

/**
 * Progressive LOD streaming of the Peru relief, like peru-simulator's fly mode: SSE
 * quadtree with parent fallback, coarse-first/nearest-first cancellable requests, bounded
 * LRU (never the working set), hysteresis, prefetch, geomorph + cross-fade, skirts, worker
 * decode and a per-frame upload budget. Recomputes only on view/viewport/tile changes.
 */
export class LodTerrain {
	readonly ready: Promise<void>;
	private readonly layer: TileLayer<HeightTile>;
	private readonly renderer: TerrainRenderer;
	private readonly sampler: TerrainSampler;
	private readonly decoders: DecoderPool;
	private readonly uploads: FrameBudget;
	private readonly roots: TileId[];
	private readonly rootKeys: Set<string>;
	private refined = new Set<string>();
	private dirty = true;
	private lastLod = Number.NEGATIVE_INFINITY;
	private lastSignature: number[] = [];
	private exaggeration: number;
	private resolveReady!: () => void;
	private rejectReady!: (e: Error) => void;
	private settled = false;
	/** Multiplies the profile's SSE threshold (coarser while a simulation runs). */
	private sseScale = 1;
	private imagerySource: ImagerySource | null = null;
	private imagery: TileLayer<ImageryTile> | null = null;
	private scratch: OffscreenCanvas | HTMLCanvasElement | null = null;

	constructor(
		private readonly scene: Scene,
		private readonly client: TilesClient,
		private readonly profile: LodProfile,
		private readonly frame: LocalFrame,
		look: TerrainLook,
		context: LodContextOptions | null = null,
		/** Weather drape (S8, src/map/weather); null = the tiles exactly as before. */
		weather: TerrainWeather | null = null,
	) {
		this.exaggeration = look.exaggeration;
		this.ready = new Promise((res, rej) => {
			this.resolveReady = res;
			this.rejectReady = rej;
		});
		this.roots = tilesCovering(PERU_BBOX, ROOT_ZOOM);
		this.rootKeys = new Set(this.roots.map(tileKey));
		this.decoders = new DecoderPool(profile.decoders);
		this.uploads = new FrameBudget(profile.uploadsPerFrame);
		this.renderer = new TerrainRenderer(
			scene,
			frame,
			profile.segments,
			look,
			context ? { parent: context.parent } : null,
			weather,
		);
		this.layer = new TileLayer<HeightTile>({
			capacity: profile.cacheCapacity,
			maxConcurrent: profile.maxConcurrent,
			maxAttempts: 3,
			retryDelayMs: 2000,
			load: (t, signal) => this.load(t, signal),
			onLoaded: () => {
				this.dirty = true;
				this.checkReady();
			},
		});
		this.sampler = new TerrainSampler(frame, {
			surface: (k) => this.layer.get(k)?.surface,
			isDisplayed: (k) => this.renderer.isDisplayed(k),
			rootZoom: ROOT_ZOOM,
			maxZoom: LOD_MAX_ZOOM,
		});
		// Start downloading the roots right away, before the first view is known.
		this.layer.update(
			this.roots.map((t) => ({ tile: t, key: tileKey(t), priority: -1 })),
			this.rootKeys,
		);
	}

	get stats(): LodStats {
		const s = this.layer.stats;
		const i = this.imagery?.stats;
		return {
			drawn: this.renderer.drawn,
			inFlight: s.inFlight,
			queued: s.queued,
			cached: s.cached,
			maxZoom: this.renderer.maxZoom,
			waitingUpload: this.uploads.waiting,
			imagery: i ? { ...i, capacity: this.profile.imageryCacheCapacity } : null,
		};
	}

	/** Ground height (km, unexaggerated) under (x, z): finest loaded data, never below the drawn surface. */
	heightKm(x: number, z: number): number {
		return this.sampler.heightAt(x, z);
	}

	setLook(look: TerrainLook): void {
		this.exaggeration = look.exaggeration;
		this.renderer.setLook(look);
		this.dirty = true;
	}

	/** Context only: where the simulated patch is drawn instead (local km). */
	setHole(hole: Hole | null): void {
		this.renderer.setHole(hole);
	}

	/**
	 * Satélite (a provider) or Relieve (null). Relieve disposes every imagery texture and
	 * cancels its requests; the LOD then selects exactly as without imagery.
	 */
	setImagery(source: ImagerySource | null): void {
		if (source === this.imagerySource) return;
		this.imagery?.clear();
		this.imagery = null;
		this.imagerySource = source;
		if (source) {
			this.imagery = new TileLayer<ImageryTile>({
				capacity: this.profile.imageryCacheCapacity,
				maxConcurrent: this.profile.imageryMaxConcurrent,
				maxAttempts: 2,
				retryDelayMs: 4000,
				load: (t, signal) => this.loadImagery(source, t, signal),
				onLoaded: () => (this.dirty = true),
			});
			const layer = this.imagery;
			this.renderer.setImagery((k) => layer.get(k)?.texture ?? undefined);
		} else {
			this.renderer.setImagery(null);
		}
		this.dirty = true;
	}

	/** Scales the SSE threshold (1 = profile); a change reselects. */
	setSseScale(scale: number): void {
		if (scale === this.sseScale) return;
		this.sseScale = scale;
		this.dirty = true;
	}

	/** Once per rendered frame, before scene.render(). */
	update(now: number, view: LodView | null): void {
		this.uploads.tick();
		// A tile that failed on a non-final attempt is due again: reselect even with an idle camera (B1).
		if (this.layer.takeDueRetry()) this.dirty = true;
		if (this.imagery?.takeDueRetry()) this.dirty = true;
		if (view && !sameSignature(view.signature, this.lastSignature)) {
			this.lastSignature = view.signature;
			this.dirty = true;
		}
		if (
			view &&
			this.dirty &&
			now - this.lastLod >= this.profile.lodIntervalMs
		) {
			this.lastLod = now;
			this.dirty = false;
			this.select(view, now);
		}
		this.renderer.update(now);
	}

	dispose(): void {
		this.imagery?.clear();
		this.imagery = null;
		this.layer.clear();
		this.renderer.dispose();
		this.decoders.dispose();
	}

	private select(view: LodView, now: number): void {
		const imagery = this.imagery;
		const source = this.imagerySource;
		const deep =
			imagery && source ? imageryLodParams(this.profile, source.maxZoom) : null;
		const hasImagery = (k: string) => !!imagery?.get(k)?.texture;
		/** Past z11 a tile exists only for its imagery: unavailable (placeholder) or broken children stop refining. */
		const imageryMissing = (k: string) =>
			!imagery ||
			imagery.isBroken(k) ||
			(imagery.isReady(k) && !imagery.get(k)!.texture);
		const r = selectTiles({
			camera: view.position,
			frustum: planesFrustum(view.frusta),
			sseFactor: view.sseFactor,
			frame: this.frame,
			rootZoom: ROOT_ZOOM,
			maxZoom: deep?.maxZoom ?? LOD_MAX_ZOOM,
			thresholdScale: deep?.thresholdScale,
			region: PERU_BBOX,
			maxScreenSpaceError: this.profile.maxScreenSpaceError * this.sseScale,
			segments: this.profile.segments,
			heightRange: (t) => this.heightRange(t),
			isReady: (k) => {
				const t = parseTileKey(k);
				return t.z <= LOD_MAX_ZOOM
					? this.layer.isReady(k)
					: this.layer.isReady(tileKey(this.terrainTileOf(t))) && hasImagery(k);
			},
			canRefine: (t) =>
				t.z < LOD_MAX_ZOOM
					? !childrenOf(t).some((c) => this.layer.isBroken(tileKey(c)))
					: !childrenOf(t).some((c) => imageryMissing(tileKey(c))),
			previouslyRefined: this.refined,
			maxPrefetch: this.profile.maxPrefetch,
			maxTiles: this.profile.maxTiles,
		});
		this.refined = r.refined;
		// The roots are always kept and loaded first: whatever turns into view has a fallback.
		const retain = new Set([
			...r.needed,
			...this.renderer.fadeSourceKeys,
			...this.rootKeys,
		]);
		// Terrain tiles past z11 are never requested: those levels draw the z11 ancestor's heights.
		const requests: TileRequest[] = r.requests.filter(
			(q) => q.tile.z <= LOD_MAX_ZOOM,
		);
		for (const t of this.roots) {
			const key = tileKey(t);
			if (!this.layer.isReady(key) && !r.needed.has(key))
				requests.unshift({ tile: t, key, priority: -1 });
		}
		this.layer.update(requests, retain);
		if (imagery) {
			// Imagery for the whole working set (coarse first, then nearest: ancestors are the
			// fallback), plus the prefetch of imagery-only children; never beyond.
			const wanted: TileRequest[] = [];
			for (const key of r.needed)
				if (!imagery.isReady(key))
					wanted.push({
						tile: parseTileKey(key),
						key,
						priority: r.priority.get(key) ?? 0,
					});
			for (const q of r.requests)
				if (q.prefetch && q.tile.z > LOD_MAX_ZOOM) wanted.push(q);
			imagery.update(
				wanted,
				new Set([...r.needed, ...this.renderer.imageryKeys]),
			);
		}
		this.renderer.setDisplay(r.display, r.morph, (t) => this.heightOf(t), now);
	}

	/** The terrain tile whose heights `t` draws: itself up to z11, else its z11 ancestor. */
	private terrainTileOf(t: TileId): TileId {
		let a = t;
		while (a.z > LOD_MAX_ZOOM) a = parentOf(a)!;
		return a;
	}

	private heightOf(t: TileId): HeightSource | undefined {
		const src = this.terrainTileOf(t);
		const h = this.layer.get(tileKey(src));
		return h ? { h, src } : undefined;
	}

	private async loadImagery(
		source: ImagerySource,
		t: TileId,
		signal: AbortSignal,
	): Promise<ImageryTile> {
		const parts = await loadImageryParts(
			source,
			imageryPlan(t, this.profile.imageryPx, source.maxZoom),
			signal,
		);
		if (parts.kind === "unavailable")
			return { texture: null, dispose: () => {} };
		try {
			await this.uploads.acquire(signal);
		} catch (err) {
			for (const p of parts.parts) p.bitmap.close();
			throw err;
		}
		const texture = this.composeImagery(parts);
		return { texture, dispose: () => texture.dispose() };
	}

	/** Draws the provider tiles into one scratch canvas and copies it into a mipmapped texture. */
	private composeImagery(
		parts: Extract<ImageryParts, { kind: "ready" }>,
	): BaseTexture {
		const size = parts.size;
		if (!this.scratch) {
			this.scratch =
				typeof OffscreenCanvas !== "undefined"
					? new OffscreenCanvas(size, size)
					: Object.assign(document.createElement("canvas"), {
							width: size,
							height: size,
						});
		}
		const canvas = this.scratch;
		if (canvas.width !== size) canvas.width = canvas.height = size;
		const ctx = canvas.getContext("2d") as
			| CanvasRenderingContext2D
			| OffscreenCanvasRenderingContext2D;
		for (const p of parts.parts) {
			ctx.drawImage(p.bitmap, p.x, p.y, 256, 256);
			p.bitmap.close();
		}
		const engine = this.scene.getEngine();
		const internal = engine.createDynamicTexture(
			size,
			size,
			true,
			Texture.TRILINEAR_SAMPLINGMODE,
		);
		// Row 0 = north at v = 0, as the height textures.
		engine.updateDynamicTexture(internal, canvas, false, false);
		const texture = new BaseTexture(this.scene, internal);
		texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
		texture.anisotropicFilteringLevel = 4;
		return texture;
	}

	/** Exaggerated scene-km height range of a tile from its own or nearest loaded ancestor's metadata. */
	private heightRange(t: TileId): [number, number] {
		const k = this.exaggeration / 1000;
		for (let a: TileId | null = t; a && a.z >= ROOT_ZOOM; a = parentOf(a)) {
			const h = this.layer.get(tileKey(a));
			if (h) return [Math.max(0, h.min) * k, Math.max(0, h.max) * k];
		}
		return [0, PERU_MAX_HEIGHT * k];
	}

	private async load(t: TileId, signal: AbortSignal): Promise<HeightTile> {
		const res = await this.client.tileBytes(t, signal);
		// Outside the service area (404): flat sea level.
		const data = res
			? await this.decoders.decode(res.buffer, this.profile.segments, signal)
			: flatTile(this.profile.segments);
		await this.uploads.acquire(signal);
		return this.upload(data);
	}

	private upload(d: PreparedTile): HeightTile {
		const texture = createHeightTexture(this.scene, d.bits, d.width, d.height);
		return {
			texture,
			surface: new TileSurface(d.grid, this.profile.segments),
			offset: d.offset,
			width: d.width,
			height: d.height,
			min: d.min,
			max: d.max,
			dispose: () => texture.dispose(),
		};
	}

	private checkReady(): void {
		if (this.settled) return;
		const state = rootsReadiness(
			[...this.rootKeys],
			(k) => this.layer.isReady(k),
			(k) => this.layer.isBroken(k),
		);
		if (state === "pending") return;
		this.settled = true;
		if (state === "ready") this.resolveReady();
		// Without every root Peru would be drawn with a hole: fall back to the simulator.
		else
			this.rejectReady(
				new Error("el servicio no devolvió todos los tiles base del Perú"),
			);
	}
}

function sameSignature(a: number[], b: number[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}
