import {
	type AbstractEngine,
	BaseTexture,
	Color3,
	Constants,
	type InternalTexture,
	Mesh,
	type Scene,
	StandardMaterial,
	Texture,
	type TransformNode,
	VertexData,
} from "@babylonjs/core";
import { type LocalFrame, worldToLocal } from "../lod/quadtree";
import type {
	TerrainWeather,
	TerrainWeatherTextures,
	TerrainWeatherUniforms,
	Vec4Tuple,
} from "../lod/terrainRenderer";
import { lonLatToWorld } from "../tileMath";
import { mercatorBoxToWorld, type WorldRect } from "./grid";
import { OverlayPainter } from "./overlay";
import { chooseRegion } from "./region";
import type { WeatherController } from "./WeatherController";

/**
 * GPU side of the weather layers (S8), one per engine: the weather textures live once in the
 * engine (InternalTexture) and are wrapped per scene (overview and simulator), so the overview,
 * its VR maquette and the simulator's map context drape the same data. Each frame the active
 * view calls update() with its footprint; textures are re-uploaded only when the controller's
 * parts change (versions), the overlay (wind trails, lightning) at a per-profile rate.
 */

export interface WeatherGpuProfile {
	/** Overlay (wind trails + lightning) canvas side, px. */
	overlayPx: number;
	particles: number;
	/** Cloud image width cap, px (decoded downscaled). */
	cloudMaxWidth: number;
	/** Overlay upload every N frames while the wind animates. */
	overlayEvery: number;
}

export const WEATHER_PROFILES: Record<"desktop" | "quest", WeatherGpuProfile> =
	{
		desktop: {
			overlayPx: 1024,
			particles: 6000,
			cloudMaxWidth: 2048,
			overlayEvery: 1,
		},
		// Quest 72 Hz on WebGL2: a third of the particles, a quarter of the overlay pixels, half the uploads.
		quest: {
			overlayPx: 512,
			particles: 2000,
			cloudMaxWidth: 1024,
			overlayEvery: 2,
		},
	};

/** Cloud sheet altitude above sea level (true km, × exaggeration): above the highest Andes. */
export const CLOUD_ALTITUDE_KM = 8;
/** Terrain darkening under an opaque cloud (overview); the context drapes the clouds instead. */
const CLOUD_SHADOW = 0.35;
const CLOUD_DRAPE = 0.85;
const FADE_MS = 350;
/** Lightning-only overlay redraw rate (age fade and the pulse of recent flashes). */
const LIGHTNING_REDRAW_MS = 250;
/** Outside the unit square: the shader's inside test rejects every point. */
const NOWHERE: Vec4Tuple = [10, 10, 1, 1];

/** Weather extent of the backend (tiles bbox + 2°) as the default overlay grid. */
const DEFAULT_GRID: WorldRect = (() => {
	const nw = lonLatToWorld(-83.5, 2.2);
	const se = lonLatToWorld(-66.5, -20.5);
	return { x0: nw.x, y0: nw.y, w: se.x - nw.x, h: se.y - nw.y };
})();

export type CloudMode = "shadow" | "drape";

/** What the active view needs this frame (Web Mercator unit square). */
export interface WeatherFocus {
	x: number;
	y: number;
	side: number;
}

const rect = (r: WorldRect): Vec4Tuple => [r.x0, r.y0, r.w, r.h];

export class WeatherGpu {
	/** Bumps when any uniform changed. */
	uniformVersion = 0;
	/** Bumps when a texture was replaced (not on in-place updates). */
	textureVersion = 0;
	private readonly painter: OverlayPainter;
	private wx: InternalTexture | null = null;
	private wxPrev: InternalTexture | null = null;
	private cape: InternalTexture | null = null;
	private clouds: InternalTexture | null = null;
	private readonly overlay: InternalTexture;
	private readonly dummy: InternalTexture;
	private readonly wrappers = new Map<
		Scene,
		Map<InternalTexture, BaseTexture>
	>();
	private seen = { scalars: -1, cape: -1, wind: -1, clouds: -1, lightning: -1 };
	private lastScalars: Uint8Array | null = null;
	private scalarSize = { w: 0, h: 0 };
	private bounds: Vec4Tuple = NOWHERE;
	private capeOn = false;
	private cloudRect: Vec4Tuple = NOWHERE;
	private fadeStart = Number.NEGATIVE_INFINITY;
	private fade = 1;
	private overlayRect: Vec4Tuple = NOWHERE;
	private overlayOn = false;
	private frameCount = 0;
	private lastUpdate = -1;
	private lastLightningDraw = Number.NEGATIVE_INFINITY;
	private signature = "";

	constructor(
		private readonly engine: AbstractEngine,
		private readonly controller: WeatherController,
		private readonly profile: WeatherGpuProfile,
	) {
		this.painter = new OverlayPainter(profile.overlayPx, profile.particles);
		this.overlay = engine.createDynamicTexture(
			profile.overlayPx,
			profile.overlayPx,
			false,
			Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
		);
		engine.updateDynamicTexture(this.overlay, this.painter.canvas, false, true);
		this.dummy = engine.createRawTexture(
			new Uint8Array(16),
			2,
			2,
			Constants.TEXTUREFORMAT_RGBA,
			false,
			false,
			Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
		);
	}

	/** Terrain binding of a scene; `cloudMode`: shadow under the sheets (overview) or draped clouds (map context). */
	binding(scene: Scene, cloudMode: CloudMode): TerrainWeather {
		const gpu = this;
		return {
			get version() {
				return gpu.uniformVersion;
			},
			get textureVersion() {
				return gpu.textureVersion;
			},
			textures: () => this.texturesFor(scene),
			uniforms: () => this.uniforms(cloudMode),
		};
	}

	/** Raised cloud sheet over the overview relief (follows `parent`, the map root). */
	cloudSheet(
		scene: Scene,
		frame: LocalFrame,
		parent: TransformNode,
	): CloudSheet {
		return new CloudSheet(scene, frame, parent, this);
	}

	/** Cloud texture of a scene (null without an image) and its world rect. */
	cloudTexture(
		scene: Scene,
	): { texture: BaseTexture; rect: Vec4Tuple; opacity: number } | null {
		const g = this.controller.gpu.clouds;
		if (!this.clouds || g.opacity <= 0) return null;
		return {
			texture: this.wrap(scene, this.clouds),
			rect: this.cloudRect,
			opacity: g.opacity,
		};
	}

	/** Once per frame by the active view, before rendering. */
	update(now: number, focus: WeatherFocus | null): void {
		if (now === this.lastUpdate) return;
		const dt =
			this.lastUpdate < 0 ? 0 : Math.min(0.1, (now - this.lastUpdate) / 1000);
		this.lastUpdate = now;
		this.frameCount++;
		const g = this.controller.gpu;
		if (g.scalars.version !== this.seen.scalars) {
			this.seen.scalars = g.scalars.version;
			this.uploadScalars(now);
		}
		if (g.cape.version !== this.seen.cape) {
			this.seen.cape = g.cape.version;
			this.capeOn = !!g.cape.rgba;
			if (g.cape.rgba) {
				this.cape = this.raw(
					this.cape,
					g.cape.rgba,
					g.cape.width,
					g.cape.height,
				);
				if (!g.scalars.rgba && g.cape.bounds)
					this.bounds = rect(mercatorBoxToWorld(g.cape.bounds));
			}
		}
		if (g.clouds.version !== this.seen.clouds) {
			this.seen.clouds = g.clouds.version;
			const img = g.clouds.image;
			if (img) {
				if (
					!this.clouds ||
					this.clouds.width !== img.width ||
					this.clouds.height !== img.height
				) {
					this.clouds?.dispose();
					this.clouds = this.engine.createDynamicTexture(
						img.width,
						img.height,
						true,
						Constants.TEXTURE_TRILINEAR_SAMPLINGMODE,
					);
					this.textureVersion++;
				}
				this.engine.updateDynamicTexture(this.clouds, img, false, false);
				// Uploaded: the controller keeps no reference to the pixels.
				img.close();
				g.clouds.image = null;
			}
		}
		if (g.clouds.meta && this.clouds)
			this.cloudRect = rect(mercatorBoxToWorld(g.clouds.meta.bounds));
		const cloudsOn =
			!!this.clouds && this.controller.isEnabled("clouds") && !!g.clouds.meta;
		if (!cloudsOn) this.cloudRect = NOWHERE;

		if (this.fade < 1)
			this.fade = Math.min(1, (now - this.fadeStart) / FADE_MS);
		this.updateOverlay(now, dt, focus);

		const u = [
			this.bounds,
			this.fade,
			this.capeOn ? g.cape.opacity : 0,
			this.cloudRect,
			g.clouds.opacity,
			this.overlayRect,
			this.overlayOn,
			!!g.scalars.rgba,
		].join();
		if (u !== this.signature) {
			this.signature = u;
			this.uniformVersion++;
		}
	}

	/** Debug/verification hook. */
	stats() {
		return {
			overlay: this.overlayOn ? this.overlayRect : null,
			region: this.painter.centre(),
			fade: this.fade,
			frames: this.frameCount,
		};
	}

	dispose(): void {
		for (const m of this.wrappers.values())
			for (const t of m.values()) t.dispose();
		this.wrappers.clear();
		for (const t of [
			this.wx,
			this.wxPrev,
			this.cape,
			this.clouds,
			this.overlay,
			this.dummy,
		])
			t?.dispose();
	}

	private uniforms(mode: CloudMode): TerrainWeatherUniforms {
		const g = this.controller.gpu;
		const scalars = !!g.scalars.rgba;
		const cloud = this.cloudRect !== NOWHERE ? g.clouds.opacity : 0;
		const on = scalars || this.capeOn || this.overlayOn || cloud > 0;
		return {
			on: on ? 1 : 0,
			bounds: this.bounds,
			mix: [
				this.fade,
				this.capeOn ? g.cape.opacity : 0,
				mode === "shadow" ? CLOUD_SHADOW * cloud : 0,
				mode === "drape" ? CLOUD_DRAPE * cloud : 0,
			],
			overlayRect: this.overlayOn ? this.overlayRect : NOWHERE,
			cloudRect: this.cloudRect,
		};
	}

	private texturesFor(scene: Scene): TerrainWeatherTextures {
		return {
			wx: this.wrap(scene, this.wx ?? this.dummy),
			wxPrev: this.wrap(scene, this.wxPrev ?? this.dummy),
			cape: this.wrap(scene, this.capeOn && this.cape ? this.cape : this.dummy),
			overlay: this.wrap(scene, this.overlay),
			clouds: this.wrap(scene, this.clouds ?? this.dummy),
		};
	}

	private wrap(scene: Scene, internal: InternalTexture): BaseTexture {
		let m = this.wrappers.get(scene);
		if (!m) {
			m = new Map();
			this.wrappers.set(scene, m);
		}
		let t = m.get(internal);
		if (!t) {
			internal.incrementReferences();
			t = new BaseTexture(scene, internal);
			t.wrapU = t.wrapV = Texture.CLAMP_ADDRESSMODE;
			m.set(internal, t);
			scene.onDisposeObservable.addOnce(() => this.wrappers.delete(scene));
		}
		return t;
	}

	/** (Re)creates `t` for a new size or updates it in place; bumps textureVersion on a new texture. */
	private raw(
		t: InternalTexture | null,
		data: Uint8Array,
		w: number,
		h: number,
	): InternalTexture {
		if (t && t.width === w && t.height === h) {
			this.engine.updateRawTexture(
				t,
				data,
				Constants.TEXTUREFORMAT_RGBA,
				false,
			);
			return t;
		}
		t?.dispose();
		this.textureVersion++;
		return this.engine.createRawTexture(
			data,
			w,
			h,
			Constants.TEXTUREFORMAT_RGBA,
			false,
			false,
			Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
		);
	}

	/** New temperature/rain composite: the previous one goes to uWxPrev and the drape cross-fades. */
	private uploadScalars(now: number): void {
		const s = this.controller.gpu.scalars;
		if (!s.rgba || !s.bounds) {
			this.lastScalars = null;
			if (!this.capeOn) this.bounds = NOWHERE;
			this.fade = 1;
			if (this.wx)
				this.wx = this.raw(
					this.wx,
					new Uint8Array(this.scalarSize.w * this.scalarSize.h * 4),
					this.scalarSize.w,
					this.scalarSize.h,
				);
			if (this.wxPrev)
				this.wxPrev = this.raw(
					this.wxPrev,
					new Uint8Array(this.scalarSize.w * this.scalarSize.h * 4),
					this.scalarSize.w,
					this.scalarSize.h,
				);
			return;
		}
		const sized =
			this.scalarSize.w === s.width && this.scalarSize.h === s.height;
		const prev =
			sized && this.lastScalars
				? this.lastScalars
				: new Uint8Array(s.rgba.length);
		this.wxPrev = this.raw(this.wxPrev, prev, s.width, s.height);
		this.wx = this.raw(this.wx, s.rgba, s.width, s.height);
		this.scalarSize = { w: s.width, h: s.height };
		this.lastScalars = s.rgba;
		this.bounds = rect(mercatorBoxToWorld(s.bounds));
		this.fade = 0;
		this.fadeStart = now;
	}

	private updateOverlay(
		now: number,
		dt: number,
		focus: WeatherFocus | null,
	): void {
		const g = this.controller.gpu;
		const windOn = !!g.wind.frame && g.wind.opacity > 0;
		const lightningOn = !!g.lightning.data && g.lightning.opacity > 0;
		if (g.wind.version !== this.seen.wind) {
			this.seen.wind = g.wind.version;
			this.painter.setWind(g.wind.frame);
			if (!windOn) this.painter.clearTrails();
		}
		const lightningChanged = g.lightning.version !== this.seen.lightning;
		this.seen.lightning = g.lightning.version;
		const wasOn = this.overlayOn;
		this.overlayOn = (windOn || lightningOn) && !!focus;
		if (!this.overlayOn || !focus) {
			if (wasOn) this.overlayRect = NOWHERE;
			return;
		}
		const grid = g.wind.frame
			? mercatorBoxToWorld(g.wind.frame.meta.bounds)
			: DEFAULT_GRID;
		const region = chooseRegion(
			this.painter.currentRegion,
			focus,
			focus.side,
			grid,
		);
		const moved = region !== this.painter.currentRegion;
		this.painter.setRegion(region);
		this.overlayRect = [region.x0, region.y0, region.side, region.side];
		if (windOn) this.painter.stepWind(dt, g.wind.opacity);
		const due = windOn
			? this.frameCount % this.profile.overlayEvery === 0
			: moved ||
				lightningChanged ||
				!wasOn ||
				now - this.lastLightningDraw >= LIGHTNING_REDRAW_MS;
		if (!due) return;
		this.lastLightningDraw = now;
		this.painter.compose(
			lightningOn ? g.lightning.data : null,
			g.lightning.opacity,
			windOn,
			Date.now(),
		);
		this.engine.updateDynamicTexture(
			this.overlay,
			this.painter.canvas,
			false,
			true,
		);
	}
}

/**
 * The cloud image as a raised transparent sheet over the overview (CLOUD_ALTITUDE_KM ×
 * exaggeration), child of the map root so it follows the VR maquette. StandardMaterial with
 * the image's alpha: identical on WebGPU and WebGL2.
 */
export class CloudSheet {
	private readonly mesh: Mesh;
	private readonly material: StandardMaterial;
	private texture: BaseTexture | null = null;
	private exaggeration = 1;

	constructor(
		private readonly scene: Scene,
		private readonly frame: LocalFrame,
		parent: TransformNode,
		private readonly gpu: WeatherGpu,
	) {
		const data = new VertexData();
		// Unit quad in x (east) and −z (south) with v = 0 at the north edge (image row 0).
		data.positions = [0, 0, 0, 1, 0, 0, 0, 0, -1, 1, 0, -1];
		data.uvs = [0, 0, 1, 0, 0, 1, 1, 1];
		data.indices = [0, 1, 2, 1, 3, 2];
		data.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
		this.mesh = new Mesh("weather-cloud-sheet", scene);
		data.applyToMesh(this.mesh);
		this.mesh.parent = parent;
		this.mesh.isPickable = false;
		this.mesh.alwaysSelectAsActiveMesh = true;
		this.material = new StandardMaterial("weather-cloud-sheet", scene);
		this.material.disableLighting = true;
		this.material.diffuseColor = Color3.White();
		this.material.emissiveColor = Color3.Black();
		this.material.specularColor = Color3.Black();
		this.material.backFaceCulling = false;
		this.material.useAlphaFromDiffuseTexture = true;
		this.material.disableDepthWrite = true;
		this.material.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
		this.mesh.material = this.material;
		this.mesh.setEnabled(false);
	}

	setExaggeration(e: number): void {
		this.exaggeration = e;
	}

	/** Each frame: follows the texture, extent and opacity of the cloud layer. */
	update(): void {
		const c = this.gpu.cloudTexture(this.scene);
		this.mesh.setEnabled(!!c);
		if (!c) return;
		if (c.texture !== this.texture) {
			this.texture = c.texture;
			c.texture.hasAlpha = true;
			this.material.diffuseTexture = c.texture;
		}
		const [x0, y0, w, h] = c.rect;
		const [west, north] = worldToLocal(this.frame, x0, y0);
		const [east, south] = worldToLocal(this.frame, x0 + w, y0 + h);
		this.mesh.position.set(west, CLOUD_ALTITUDE_KM * this.exaggeration, north);
		this.mesh.scaling.set(east - west, 1, north - south);
		this.material.alpha = c.opacity;
	}

	dispose(): void {
		this.mesh.dispose();
		this.material.dispose();
	}
}
