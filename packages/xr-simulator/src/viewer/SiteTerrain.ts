import {
	type Camera,
	type Ray,
	type Scene,
	TransformNode,
	Vector3,
} from "@babylonjs/core";
import { raycastHeightField } from "../input/raycast";
import type { ImagerySource } from "../map/imagery/imagerySource";
import type { MapContextView } from "../map/MapContextView";
import { fetchLocalGrid } from "../map/peruTerrain";
import {
	lonLatToWorld,
	metresPerWorldUnit,
	worldToLonLat,
} from "../map/tileMath";
import type { TilesClient } from "../map/tilesClient";
import { TerrainView } from "../render/TerrainView";
import { type HeightGrid, Terrain } from "../scenario/terrain";

/** Cells of the real-relief patch: ~19 km at the native z11 spacing (~37 m). */
export const SITE_RESOLUTION = 512;
/** Cells of the clipped maquette patch, resampled from the loaded one. */
const CLIP_RESOLUTION = 128;

export interface GeoPoint {
	lat: number;
	lng: number;
}

export interface LocalPoint {
	x: number;
	z: number;
}

export interface SiteClip {
	center: LocalPoint;
	sizeM: number;
}

export interface SiteTerrainOptions {
	scene: Scene;
	/** Centre of the patch and origin of the local frame. */
	origin: GeoPoint;
	resolution?: number;
	/** The relief arrived (load or setGrid). */
	onLoaded?(): void;
}

/** Real Peru relief around the patch: the viewer's streamed LOD with its imagery and weather. */
export type SiteContextFactory = (
	scene: Scene,
	parent: TransformNode,
) => MapContextView;

/**
 * The real relief around a site from the tiles backend, for content authored in a right-handed
 * local metric frame (+x east, +y up, -z north, metres; Web Mercator scaled by cos(lat) at the
 * site), such as the host app's structures. The simulator's grid frame (x east, z north, origin at
 * the south-west corner) is mirrored into that frame by one node, so its meshes, the real-relief
 * context and the CPU raycast are reused unchanged.
 */
export class SiteTerrain {
	readonly root: TransformNode;
	private readonly gridNode: TransformNode;
	private readonly clipNode: TransformNode;
	private readonly centre: { x: number; y: number };
	private readonly metresPerUnit: number;
	private readonly context: MapContextView | null;
	private terrain: Terrain | null = null;
	private view: TerrainView | null = null;
	private clipView: TerrainView | null = null;
	private clip: SiteClip | null = null;
	private opacity = 1;
	private disposed = false;

	constructor(
		private readonly options: SiteTerrainOptions,
		private readonly tiles: TilesClient | null = null,
		context: SiteContextFactory | null = null,
	) {
		const { scene, origin } = options;
		this.root = new TransformNode("site-terrain", scene);
		this.gridNode = new TransformNode("site-terrain-grid", scene);
		this.gridNode.parent = this.root;
		// Grid z (north) becomes local -z: a mirror, so Babylon flips the face winding by itself.
		this.gridNode.scaling.set(1, 1, -1);
		this.clipNode = new TransformNode("site-terrain-clip", scene);
		this.clipNode.parent = this.root;
		this.clipNode.scaling.set(1, 1, -1);
		this.centre = lonLatToWorld(origin.lng, origin.lat);
		this.metresPerUnit = metresPerWorldUnit(origin.lat);
		this.context = context?.(scene, this.gridNode) ?? null;
	}

	/** Downloads the relief around the origin (rejects when the tiles backend fails). */
	async load(): Promise<void> {
		if (!this.tiles) throw new Error("Sin servicio de tiles para el terreno");
		const { origin, resolution } = this.options;
		const grid = await fetchLocalGrid(
			this.tiles,
			origin.lng,
			origin.lat,
			resolution ?? SITE_RESOLUTION,
		);
		if (!this.disposed) this.setGrid(grid);
	}

	setGrid(grid: HeightGrid): void {
		const terrain = new Terrain(grid);
		const half = terrain.size / 2;
		this.terrain = terrain;
		this.gridNode.position.set(-half, 0, half);
		this.view?.dispose();
		this.view = new TerrainView(
			this.options.scene,
			this.gridNode,
			terrain,
			false,
		);
		const { origin } = this.options;
		this.context?.set({ lon: origin.lng, lat: origin.lat }, terrain);
		this.setClip(this.clip);
		this.setOpacity(this.opacity);
		this.options.onLoaded?.();
	}

	heightAt(point: LocalPoint): number | null {
		const terrain = this.terrain;
		if (!terrain) return null;
		const half = terrain.size / 2;
		if (Math.abs(point.x) > half || Math.abs(point.z) > half) return null;
		return terrain.heightAt(point.x + half, half - point.z);
	}

	/** First relief point along a world ray, in root-local metres; null on a miss. */
	pick(worldRay: Ray): Vector3 | null {
		const terrain = this.terrain;
		if (!terrain) return null;
		const toGrid = this.gridNode.computeWorldMatrix(true).clone().invert();
		const origin = Vector3.TransformCoordinates(worldRay.origin, toGrid);
		const direction = Vector3.TransformNormal(
			worldRay.direction,
			toGrid,
		).normalize();
		const hit = raycastHeightField(terrain, {
			origin: [origin.x, origin.y, origin.z],
			direction: [direction.x, direction.y, direction.z],
		});
		if (!hit) return null;
		const half = terrain.size / 2;
		return new Vector3(hit.point[0] - half, hit.point[1], half - hit.point[2]);
	}

	toLocal(point: GeoPoint): LocalPoint {
		const world = lonLatToWorld(point.lng, point.lat);
		return {
			x: (world.x - this.centre.x) * this.metresPerUnit,
			z: (world.y - this.centre.y) * this.metresPerUnit,
		};
	}

	toGeo(point: LocalPoint): GeoPoint {
		const geo = worldToLonLat(
			this.centre.x + point.x / this.metresPerUnit,
			this.centre.y + point.z / this.metresPerUnit,
		);
		return { lat: geo.lat, lng: geo.lon };
	}

	/**
	 * Draws only a square around a point (the XR maquette), resampled into its own mesh; the
	 * real-relief context hides meanwhile. Heights and picking keep the whole patch.
	 */
	setClip(clip: SiteClip | null): void {
		this.clip = clip;
		this.clipView?.dispose();
		this.clipView = null;
		const terrain = this.terrain;
		if (clip && terrain) {
			const cellSize = clip.sizeM / CLIP_RESOLUTION;
			const heights = new Float32Array(CLIP_RESOLUTION * CLIP_RESOLUTION);
			const west = clip.center.x - clip.sizeM / 2;
			const south = -clip.center.z - clip.sizeM / 2;
			const half = terrain.size / 2;
			for (let j = 0; j < CLIP_RESOLUTION; j++) {
				for (let i = 0; i < CLIP_RESOLUTION; i++) {
					heights[j * CLIP_RESOLUTION + i] = terrain.heightAt(
						west + (i + 0.5) * cellSize + half,
						south + (j + 0.5) * cellSize + half,
					);
				}
			}
			this.clipNode.position.set(west, 0, -south);
			this.clipView = new TerrainView(
				this.options.scene,
				this.clipNode,
				new Terrain({ resolution: CLIP_RESOLUTION, cellSize, heights }),
				false,
			);
			this.clipView.mesh.visibility = this.opacity;
		}
		this.view?.mesh.setEnabled(!this.clipView);
	}

	/** Tunnels show through a translucent relief. */
	setOpacity(opacity: number): void {
		this.opacity = opacity;
		for (const view of [this.view, this.clipView])
			if (view) view.mesh.visibility = opacity;
	}

	/** Satélite (a provider) or Relieve (null) on the real-relief context. */
	setImagery(source: ImagerySource | null): void {
		this.context?.setImagery(source);
	}

	/** Once per frame before rendering: streams the context for the camera (hidden while clipped). */
	update(camera: Camera): void {
		const engine = this.options.scene.getEngine();
		const pixelHeight =
			engine.getRenderHeight() /
			Math.min(Math.max(window.devicePixelRatio, 1), 2);
		this.context?.update(camera, pixelHeight, {
			simulating: false,
			inXr: this.clip !== null,
		});
	}

	dispose(): void {
		this.disposed = true;
		this.context?.dispose();
		this.clipView?.dispose();
		this.view?.dispose();
		this.root.dispose();
	}
}
