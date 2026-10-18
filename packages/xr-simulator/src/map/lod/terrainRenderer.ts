import {
	type BaseTexture,
	Geometry,
	Mesh,
	RawTexture,
	type Scene,
	type ShaderMaterial,
	type TransformNode,
	Vector2,
	Vector3,
	Vector4,
	VertexData,
} from "@babylonjs/core";
import { type ImageryBinding, imageryBinding } from "../imagery/imagerySource";
import type { TileId } from "../tileMath";
import { createHeightTexture } from "./heightTexture";
import {
	ancestorUv,
	type LocalFrame,
	parentOf,
	parseTileKey,
	tileKey,
	tileRect,
	tileWorldBox,
} from "./quadtree";
import {
	applyLook,
	createTileMaterial,
	NO_HOLE,
	type TerrainLook,
} from "./terrainMaterial";
import type { TileSurface } from "./tileData";
import { createTileGrid } from "./tileGeometry";

/** Duration of the geomorph ramp and shading/imagery cross-fade of a newly refined tile (ms). */
export const TRANSITION_MS = 300;

/** A loaded height tile: R16F texture + CPU surface. */
export interface HeightTile {
	texture: RawTexture;
	surface: TileSurface;
	offset: number;
	width: number;
	height: number;
	/** Metres (nodata excluded). */
	min: number;
	max: number;
	dispose(): void;
}

/** The height texture a tile draws: its own, or (past the terrain's max zoom) an ancestor's. */
export interface HeightSource {
	h: HeightTile;
	/** Tile whose data `h` is (the tile itself or an ancestor). */
	src: TileId;
}

/** Imagery textures by quadtree key; null while the Relieve shading is selected. */
export type ImageryLookup = ((key: string) => BaseTexture | undefined) | null;

/** 0 when a tile appears, 1 after TRANSITION_MS (geomorph ramp and cross-fade progress). */
export function transitionProgress(now: number, since: number): number {
	return Math.min(1, Math.max(0, (now - since) / TRANSITION_MS));
}

interface ActiveTile {
	tile: TileId;
	mesh: Mesh;
	material: ShaderMaterial;
	lodMorph: number;
	appearedAt: number;
	/** It replaced a drawn ancestor: geomorph ramp over TRANSITION_MS. */
	refining: boolean;
	/** Cross-fade from the colour drawn before (ancestor or coarser imagery), or null. */
	fadeStart: number | null;
	/** Height key the fade samples (keep cached). */
	fadeKey: string | null;
	/** Imagery key the fade samples (keep cached). */
	fadeImageryKey: string | null;
	morph: number;
	height: HeightSource;
	/** Imagery drawn now (own or an ancestor's), null = hypsometric. */
	imagery: ImageryBinding | null;
	/** Finer imagery that arrived during a fade; applied (with its own fade) once it ends. */
	pendingImagery: ImageryBinding | null | undefined;
}

/** Map-context placement (src/map/MapContext.ts): tiles follow `parent`, with a hole. */
export interface RendererPlacement {
	parent: TransformNode;
}

export type Vec4Tuple = [number, number, number, number];

/** Weather textures of one scene (src/map/weather/WeatherGpu.ts). */
export interface TerrainWeatherTextures {
	wx: BaseTexture;
	wxPrev: BaseTexture;
	cape: BaseTexture;
	overlay: BaseTexture;
	clouds: BaseTexture;
}

/** Global weather uniforms (boxes in the Web Mercator unit square: x0, y0, w, h). */
export interface TerrainWeatherUniforms {
	on: number;
	bounds: Vec4Tuple;
	/** (temperature/rain fade, CAPE opacity, cloud shadow, draped cloud opacity). */
	mix: Vec4Tuple;
	overlayRect: Vec4Tuple;
	cloudRect: Vec4Tuple;
}

/** Weather drape of the tiles (S8): WEATHER shader variant, rebound when a version changes. */
export interface TerrainWeather {
	readonly version: number;
	readonly textureVersion: number;
	textures(): TerrainWeatherTextures;
	uniforms(): TerrainWeatherUniforms;
}

/** Local-km rectangle [minX, minZ, maxX, maxZ] where the tiles draw nothing. */
export type Hole = readonly [number, number, number, number];

/**
 * Draws the displayed tile set with one shared grid geometry (after peru-simulator's
 * terrain-renderer.ts). Meshes and materials are pooled, so steady navigation allocates nothing.
 * With imagery (S7) each tile binds its own imagery or its nearest ready ancestor's (parent
 * fallback, no holes) and cross-fades over TRANSITION_MS whenever what it draws changes:
 * when it replaces an ancestor and when finer imagery arrives.
 */
export class TerrainRenderer {
	private readonly geometry: Geometry;
	private readonly active = new Map<string, ActiveTile>();
	private readonly pool: { mesh: Mesh; material: ShaderMaterial }[] = [];
	private readonly dummy: RawTexture;
	private readonly dummyImagery: RawTexture;
	private nextId = 0;
	private hole: Vector4 = new Vector4(...NO_HOLE);
	private imagery: ImageryLookup = null;
	private weatherVersion = -1;
	private weatherTextureVersion = -1;

	constructor(
		private readonly scene: Scene,
		private readonly frame: LocalFrame,
		private readonly segments: number,
		private look: TerrainLook,
		private readonly placement: RendererPlacement | null = null,
		/** Weather drape (S8); null compiles the tiles exactly as before (no WEATHER define). */
		private readonly weather: TerrainWeather | null = null,
	) {
		const grid = createTileGrid(segments);
		const data = new VertexData();
		data.positions = grid.positions;
		data.indices = grid.indices;
		this.geometry = new Geometry("peru-tile-grid", scene, data, false);
		// Same format as the tiles (R16F), bound while a slot has no texture.
		this.dummy = createHeightTexture(scene, new Uint16Array(4), 2, 2);
		this.dummyImagery = RawTexture.CreateRGBATexture(
			new Uint8Array(16),
			2,
			2,
			scene,
			false,
		);
	}

	get drawn(): number {
		return this.active.size;
	}

	get maxZoom(): number {
		let z = 0;
		for (const a of this.active.values()) z = Math.max(z, a.tile.z);
		return z;
	}

	isDisplayed(key: string): boolean {
		return this.active.has(key);
	}

	/** Height keys whose texture a cross-fade still samples: keep them cached. */
	get fadeSourceKeys(): Set<string> {
		const keys = new Set<string>();
		for (const a of this.active.values()) if (a.fadeKey) keys.add(a.fadeKey);
		return keys;
	}

	/** Imagery keys drawn or faded from (ancestors included): keep them cached. */
	get imageryKeys(): Set<string> {
		const keys = new Set<string>();
		for (const a of this.active.values()) {
			if (a.imagery) keys.add(a.imagery.key);
			if (a.pendingImagery) keys.add(a.pendingImagery.key);
			if (a.fadeImageryKey) keys.add(a.fadeImageryKey);
		}
		return keys;
	}

	setLook(look: TerrainLook): void {
		this.look = look;
		for (const a of this.active.values()) this.place(a);
		for (const p of this.pool) applyLook(p.material, look);
	}

	/** Context only: no tile fragment is drawn inside `hole` (local km); null removes it. */
	setHole(hole: Hole | null): void {
		this.hole = new Vector4(...(hole ?? NO_HOLE));
		for (const a of this.active.values())
			a.material.setVector4("uHole", this.hole);
		for (const p of this.pool) p.material.setVector4("uHole", this.hole);
	}

	/**
	 * Satélite (a lookup) or Relieve (null). Switching to Relieve is immediate and exactly the
	 * previous hypsometric shading; switching to Satélite fades the imagery in as it arrives.
	 */
	setImagery(lookup: ImageryLookup): void {
		this.imagery = lookup;
		if (lookup) return;
		for (const a of this.active.values()) {
			a.imagery = null;
			a.pendingImagery = undefined;
			a.fadeImageryKey = null;
			a.material.setFloat("uImageryOn", 0);
			a.material.setFloat("uParentImageryOn", 0);
			a.material.setTexture("uImagery", this.dummyImagery);
			a.material.setTexture("uParentImagery", this.dummyImagery);
		}
	}

	setDisplay(
		display: readonly TileId[],
		morph: ReadonlyMap<string, number>,
		heights: (t: TileId) => HeightSource | undefined,
		now: number,
	): void {
		const wanted = new Map(display.map((t) => [tileKey(t), t] as const));
		// What each tile drew before this change: the colour a replacing tile fades in from.
		const previous = new Map<
			string,
			{ height: HeightSource; imagery: ImageryBinding | null }
		>();
		for (const [key, a] of this.active)
			previous.set(key, { height: a.height, imagery: a.imagery });
		for (const [key, a] of this.active) {
			if (!wanted.has(key) || !heights(a.tile)) {
				this.active.delete(key);
				this.release(a);
			}
		}
		for (const [key, tile] of wanted) {
			const h = heights(tile);
			if (!h) continue;
			let a = this.active.get(key);
			if (!a) {
				a = this.activate(tile, h, previous, now);
				this.active.set(key, a);
			} else {
				this.refreshImagery(a, now);
			}
			a.lodMorph = morph.get(key) ?? 1;
		}
		this.update(now);
	}

	/** Advances the time-based transitions; once per frame. */
	update(now: number): void {
		this.syncWeather();
		for (const a of this.active.values()) {
			const t = a.refining ? transitionProgress(now, a.appearedAt) : 1;
			// A refined tile starts on its parent's surface even if its data arrived late.
			const m = Math.min(a.lodMorph, t);
			if (m !== a.morph) {
				a.morph = m;
				a.material.setFloat("uMorph", m);
			}
			if (a.fadeStart !== null) {
				const f = transitionProgress(now, a.fadeStart);
				if (f >= 1) this.endFade(a, now);
				else a.material.setFloat("uParentFade", 1 - f);
			}
		}
	}

	/** Pushes changed weather uniforms (and replaced textures) to every tile material. */
	private syncWeather(): void {
		const w = this.weather;
		if (
			!w ||
			(w.version === this.weatherVersion &&
				w.textureVersion === this.weatherTextureVersion)
		)
			return;
		const textures = w.textureVersion !== this.weatherTextureVersion;
		this.weatherVersion = w.version;
		this.weatherTextureVersion = w.textureVersion;
		for (const a of this.active.values())
			this.bindWeather(a.material, textures);
		for (const p of this.pool) this.bindWeather(p.material, textures);
	}

	private bindWeather(m: ShaderMaterial, textures: boolean): void {
		const w = this.weather;
		if (!w) return;
		if (textures) {
			const t = w.textures();
			m.setTexture("uWx", t.wx);
			m.setTexture("uWxPrev", t.wxPrev);
			m.setTexture("uWxCape", t.cape);
			m.setTexture("uWxOverlay", t.overlay);
			m.setTexture("uWxClouds", t.clouds);
		}
		const u = w.uniforms();
		m.setFloat("uWxOn", u.on);
		m.setVector4("uWxBounds", new Vector4(...u.bounds));
		m.setVector4("uWxMix", new Vector4(...u.mix));
		m.setVector4("uWxOverlayRect", new Vector4(...u.overlayRect));
		m.setVector4("uWxCloudRect", new Vector4(...u.cloudRect));
	}

	dispose(): void {
		for (const a of this.active.values()) this.release(a);
		this.active.clear();
		for (const p of this.pool) {
			p.mesh.dispose();
			p.material.dispose();
		}
		this.pool.length = 0;
		this.geometry.dispose();
		this.dummy.dispose();
		this.dummyImagery.dispose();
	}

	private bindingFor(tile: TileId): ImageryBinding | null {
		const lookup = this.imagery;
		return lookup ? imageryBinding(tile, (k) => lookup(k) !== undefined) : null;
	}

	private activate(
		tile: TileId,
		h: HeightSource,
		previous: ReadonlyMap<
			string,
			{ height: HeightSource; imagery: ImageryBinding | null }
		>,
		now: number,
	): ActiveTile {
		const { mesh, material } = this.acquire();
		const a: ActiveTile = {
			tile,
			mesh,
			material,
			lodMorph: 1,
			appearedAt: now,
			refining: false,
			fadeStart: null,
			fadeKey: null,
			fadeImageryKey: null,
			morph: -1,
			height: h,
			imagery: null,
			pendingImagery: undefined,
		};
		this.bindHeight(material, "uHeight", "uHeightTexel", "uHeightOffset", h);
		material.setVector3("uHeightUv", uvVector(tile, h.src));
		material.setFloat("uHeightSize", tileRect(this.frame, h.src).size);
		this.place(a);
		this.bindImagery(a, this.bindingFor(tile));
		let anc = parentOf(tile);
		while (anc && !previous.has(tileKey(anc))) anc = parentOf(anc);
		const before = anc ? previous.get(tileKey(anc)) : undefined;
		if (before) {
			a.refining = true;
			this.startFade(a, before.height, before.imagery, now);
		}
		mesh.setEnabled(true);
		return a;
	}

	/** Finer (or coarser) imagery became available for a drawn tile: fade to it. */
	private refreshImagery(a: ActiveTile, now: number): void {
		const next = this.bindingFor(a.tile);
		if (sameBinding(next, a.imagery)) {
			a.pendingImagery = undefined;
			return;
		}
		if (a.fadeStart !== null) {
			a.pendingImagery = next;
			return;
		}
		const old = a.imagery;
		this.bindImagery(a, next);
		this.startFade(a, a.height, old, now);
	}

	private endFade(a: ActiveTile, now: number): void {
		a.fadeStart = null;
		a.fadeKey = null;
		a.fadeImageryKey = null;
		a.material.setTexture("uParentHeight", this.dummy);
		a.material.setTexture("uParentImagery", this.dummyImagery);
		a.material.setFloat("uParentImageryOn", 0);
		a.material.setFloat("uParentFade", 0);
		const pending = a.pendingImagery;
		a.pendingImagery = undefined;
		// The pending texture may have left the cache meanwhile: re-resolve.
		if (pending !== undefined) this.refreshImagery(a, now);
	}

	/** Fades from `height` shaded with `imagery` (both as drawn before) to what the tile draws now. */
	private startFade(
		a: ActiveTile,
		height: HeightSource,
		imagery: ImageryBinding | null,
		now: number,
	): void {
		const m = a.material;
		this.bindHeight(
			m,
			"uParentHeight",
			"uParentTexel",
			"uParentOffset",
			height,
		);
		m.setVector3("uParentUv", uvVector(a.tile, height.src));
		m.setFloat("uParentSize", tileRect(this.frame, height.src).size);
		a.fadeKey = tileKey(height.src);
		const tex = imagery && this.imagery ? this.imagery(imagery.key) : undefined;
		if (imagery && tex) {
			m.setTexture("uParentImagery", tex);
			m.setVector3(
				"uParentImageryUv",
				uvVector(a.tile, parseTileKey(imagery.key)),
			);
			m.setFloat("uParentImageryOn", 1);
			a.fadeImageryKey = imagery.key;
		} else {
			m.setTexture("uParentImagery", this.dummyImagery);
			m.setFloat("uParentImageryOn", 0);
			a.fadeImageryKey = null;
		}
		m.setFloat("uParentFade", 1);
		a.fadeStart = now;
	}

	private bindHeight(
		m: ShaderMaterial,
		tex: string,
		texel: string,
		offset: string,
		h: HeightSource,
	): void {
		m.setTexture(tex, h.h.texture);
		m.setVector2(texel, new Vector2(1 / h.h.width, 1 / h.h.height));
		m.setFloat(offset, h.h.offset);
	}

	private bindImagery(a: ActiveTile, b: ImageryBinding | null): void {
		const tex = b && this.imagery ? this.imagery(b.key) : undefined;
		const m = a.material;
		if (b && tex) {
			m.setTexture("uImagery", tex);
			m.setVector3("uImageryUv", new Vector3(b.offsetU, b.offsetV, b.scale));
			m.setFloat("uImageryOn", 1);
			a.imagery = b;
		} else {
			m.setTexture("uImagery", this.dummyImagery);
			m.setFloat("uImageryOn", 0);
			a.imagery = null;
		}
	}

	private place(a: ActiveTile): void {
		const r = tileRect(this.frame, a.tile);
		const m = a.material;
		m.setVector2("uOrigin", new Vector2(r.west, r.north));
		m.setFloat("uSize", r.size);
		// Deep enough for the exaggerated height jumps between LOD levels.
		m.setFloat("uSkirtDepth", 0.05 + r.size * 0.01 * this.look.exaggeration);
		applyLook(m, this.look);
		if (this.weather) {
			const b = tileWorldBox(a.tile);
			m.setVector3("uTileWorld", new Vector3(b.minX, b.minY, b.maxX - b.minX));
		}
	}

	private acquire(): { mesh: Mesh; material: ShaderMaterial } {
		const pooled = this.pool.pop();
		if (pooled) return pooled;
		const id = this.nextId++;
		const mesh = new Mesh(`peru-tile-${id}`, this.scene);
		this.geometry.applyToMesh(mesh);
		// Culling is done by the quadtree; the unit-square bounds would be wrong anyway.
		mesh.alwaysSelectAsActiveMesh = true;
		mesh.doNotSyncBoundingInfo = true;
		mesh.isPickable = false;
		// Overview: identity world matrix. Context: the tiles follow their parent (the simulator root).
		if (this.placement) mesh.parent = this.placement.parent;
		else mesh.freezeWorldMatrix();
		const material = createTileMaterial(
			this.scene,
			id,
			this.segments,
			this.look,
			this.dummy,
			this.dummyImagery,
			!!this.placement,
			!!this.weather,
		);
		if (this.placement) material.setVector4("uHole", this.hole);
		if (this.weather) {
			material.setVector3("uTileWorld", new Vector3(0, 0, 1));
			this.bindWeather(material, true);
		}
		mesh.material = material;
		return { mesh, material };
	}

	private release(a: ActiveTile): void {
		a.mesh.setEnabled(false);
		const m = a.material;
		m.setTexture("uHeight", this.dummy);
		m.setTexture("uParentHeight", this.dummy);
		m.setTexture("uImagery", this.dummyImagery);
		m.setTexture("uParentImagery", this.dummyImagery);
		m.setFloat("uImageryOn", 0);
		m.setFloat("uParentImageryOn", 0);
		m.setFloat("uParentFade", 0);
		m.setFloat("uMorph", 1);
		this.pool.push({ mesh: a.mesh, material: m });
	}
}

/** (offset u, offset v, scale) of `tile` inside the texture of `src` (itself or an ancestor). */
function uvVector(tile: TileId, src: TileId): Vector3 {
	const uv = ancestorUv(tile, src);
	return new Vector3(uv.offsetU, uv.offsetV, uv.scale);
}

function sameBinding(
	a: ImageryBinding | null,
	b: ImageryBinding | null,
): boolean {
	return a === b || (!!a && !!b && a.key === b.key);
}
