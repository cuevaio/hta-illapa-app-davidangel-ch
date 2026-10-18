import {
	Geometry,
	Mesh,
	RawTexture,
	type Scene,
	Texture,
	TransformNode,
	type Vector3,
	VertexBuffer,
} from "@babylonjs/core";
import {
	GRID_SEGMENTS_COUNT,
	MAX_ELEVATION_ZOOM_LEVEL,
	POSITION_COMPONENTS_COUNT,
	RGBA_CHANNELS_COUNT,
	TRANSITION_MS,
} from "../constants";
import { type LocalFrame, mercatorToLocal } from "../domain/local-frame";
import { createTileGridBuffers } from "../domain/tile-grid";
import {
	ancestorAtZoom,
	ancestorUvTransform,
	parentOf,
	tileBoundsMercator,
	tileKey,
} from "../domain/tile-math";
import type { TileId } from "../domain/types";
import {
	type SharedTerrainUniforms,
	TerrainMaterial,
} from "./terrain-material";
import type { HeightResource, ImageryResource } from "./tile-resources";

class TileMesh extends Mesh {
	constructor(
		scene: Scene,
		readonly terrainMaterial: TerrainMaterial,
	) {
		super("terrain-tile", scene);
		this.material = terrainMaterial;
	}
}

interface SampledImagery {
	tile: TileId;
	texture: NonNullable<ImageryResource["texture"]>;
}

interface ActiveTile {
	mesh: TileMesh;
	lodMorph: number;
	appearedAt: number;
	refining: boolean;
	fadeKey: string | null;
}

export interface TileTextures {
	height(key: string): HeightResource | undefined;
	imagery(key: string): ImageryResource | undefined;
}
export class TerrainRenderer {
	readonly root: TransformNode;
	readonly segments: number;
	private readonly geometry: Geometry;
	private readonly fallback: RawTexture;
	private readonly active = new Map<string, ActiveTile>();
	private readonly pool: TileMesh[] = [];

	constructor(
		private readonly scene: Scene,
		private readonly frame: LocalFrame,
		private readonly shared: SharedTerrainUniforms,
		segments = GRID_SEGMENTS_COUNT,
	) {
		this.segments = segments;
		this.root = new TransformNode("terrain", scene);
		const buffers = createTileGridBuffers(segments);
		this.geometry = new Geometry("terrain-grid", scene);
		this.geometry.setVerticesData(
			VertexBuffer.PositionKind,
			buffers.positions,
			false,
			POSITION_COMPONENTS_COUNT,
		);
		this.geometry.setVerticesData("aSkirt", buffers.skirt, false, 1);
		this.geometry.setIndices(buffers.indices);
		this.fallback = RawTexture.CreateRGBATexture(
			new Uint8Array(RGBA_CHANNELS_COUNT),
			1,
			1,
			scene,
			false,
			false,
			Texture.NEAREST_SAMPLINGMODE,
		);
	}

	get transitioning(): boolean {
		for (const entry of this.active.values()) if (entry.refining) return true;
		return false;
	}
	get fadeSourceKeys(): Set<string> {
		const keys = new Set<string>();
		for (const activeTile of this.active.values())
			if (activeTile.fadeKey) keys.add(activeTile.fadeKey);
		return keys;
	}

	setDisplay(
		display: readonly TileId[],
		morph: ReadonlyMap<string, number>,
		textures: TileTextures,
		cameraPosition: Vector3,
		now: number,
	): void {
		const wanted = new Map<string, TileId>();
		for (const tile of display) wanted.set(tileKey(tile), tile);
		const previous = new Set(this.active.keys());
		for (const [key, entry] of this.active) {
			if (!wanted.has(key)) {
				this.active.delete(key);
				entry.mesh.setEnabled(false);
				entry.mesh.terrainMaterial.uniforms.uHeight.value = null;
				entry.mesh.terrainMaterial.uniforms.uImagery.value = null;
				entry.mesh.terrainMaterial.uniforms.uParentImagery.value = null;
				entry.mesh.terrainMaterial.uniforms.uParentFade.value = 0;
				entry.mesh.terrainMaterial.uniforms.uMorph.value = 1;
				this.pool.push(entry.mesh);
			}
		}
		const order: { mesh: TileMesh; distance: number }[] = [];
		for (const [key, tile] of wanted) {
			const height = textures.height(key);
			if (!height) continue;
			let entry = this.active.get(key);
			if (!entry) {
				entry = this.activate(tile, previous, textures, now);
				this.active.set(key, entry);
			}
			entry.lodMorph = morph.get(key) ?? 1;
			const mesh = entry.mesh;
			const uniforms = mesh.terrainMaterial.uniforms;
			uniforms.uHeight.value = height.texture;
			uniforms.uHeightTexel.value.set(
				1 / height.tile.width,
				1 / height.tile.height,
			);
			uniforms.uHeightOffset.value = height.tile.offset;
			const heightUv = ancestorUvTransform(
				tile,
				ancestorAtZoom(tile, MAX_ELEVATION_ZOOM_LEVEL),
			);
			uniforms.uHeightUv.value.set(
				heightUv.offsetU,
				heightUv.offsetV,
				heightUv.scale,
			);
			const imagery = this.findImagery(tile, textures);
			uniforms.uImagery.value = imagery?.texture ?? null;
			uniforms.uHasImagery.value = imagery ? 1 : 0;
			if (imagery) {
				const imageryUv = ancestorUvTransform(tile, imagery.tile);
				uniforms.uImageryUv.value.set(
					imageryUv.offsetU,
					imageryUv.offsetV,
					imageryUv.scale,
				);
			}
			const centerDistanceX =
				uniforms.uOrigin.value.x + uniforms.uSize.value / 2 - cameraPosition.x;
			const centerDistanceZ =
				uniforms.uOrigin.value.y + uniforms.uSize.value / 2 - cameraPosition.z;
			order.push({
				mesh,
				distance:
					centerDistanceX * centerDistanceX + centerDistanceZ * centerDistanceZ,
			});
		}
		// Displaced tiles retain unit-grid bounds, so translucent sorting needs explicit distances.
		order.sort((firstTile, secondTile) =>
			this.shared.uOpacity.value < 1
				? secondTile.distance - firstTile.distance
				: firstTile.distance - secondTile.distance,
		);
		order.forEach((orderedTile, tileIndex) => {
			orderedTile.mesh.alphaIndex = tileIndex;
		});
		this.update(now);
	}
	update(now: number): void {
		for (const entry of this.active.values()) {
			const uniforms = entry.mesh.terrainMaterial.uniforms;
			const progress = entry.refining
				? Math.min(1, Math.max(0, (now - entry.appearedAt) / TRANSITION_MS))
				: 1;
			// A refined tile starts on its parent's surface even if its data arrived late.
			uniforms.uMorph.value = Math.min(entry.lodMorph, progress);
			if (progress >= 1) entry.refining = false;
			if (entry.fadeKey && progress >= 1) {
				entry.fadeKey = null;
				uniforms.uParentImagery.value = null;
			}
			uniforms.uParentFade.value = entry.fadeKey ? 1 - progress : 0;
			entry.mesh.terrainMaterial.sync();
		}
	}

	setOpacity(opacity: number): void {
		this.shared.uOpacity.value = opacity;
		for (const entry of this.active.values())
			entry.mesh.terrainMaterial.setOpacity(opacity);
		for (const mesh of this.pool) mesh.terrainMaterial.setOpacity(opacity);
	}

	dispose(): void {
		for (const mesh of [
			...[...this.active.values()].map((activeTile) => activeTile.mesh),
			...this.pool,
		]) {
			mesh.terrainMaterial.dispose();
			mesh.dispose();
		}
		this.root.dispose();
		this.active.clear();
		this.pool.length = 0;
		this.geometry.dispose();
		this.fallback.dispose();
	}

	private findImagery(
		tile: TileId,
		textures: TileTextures,
	): SampledImagery | undefined {
		let ancestor: TileId | null = tile;
		while (ancestor) {
			const texture = textures.imagery(tileKey(ancestor))?.texture;
			if (texture) return { tile: ancestor, texture };
			ancestor = parentOf(ancestor);
		}
		return undefined;
	}

	private activate(
		tile: TileId,
		previous: ReadonlySet<string>,
		textures: TileTextures,
		now: number,
	): ActiveTile {
		const mesh =
			this.pool.pop() ??
			new TileMesh(
				this.scene,
				new TerrainMaterial(
					this.scene,
					this.shared,
					this.segments,
					this.fallback,
				),
			);
		this.geometry.applyToMesh(mesh);
		// Culling is done by the quadtree; the unit-square bounds would be wrong anyway.
		mesh.alwaysSelectAsActiveMesh = true;
		mesh.isPickable = false;
		mesh.parent = this.root;
		mesh.setEnabled(true);
		const mercator = tileBoundsMercator(tile);
		const northwest = mercatorToLocal(this.frame, mercator.minX, mercator.maxY);
		const southeast = mercatorToLocal(this.frame, mercator.maxX, mercator.minY);
		mesh.terrainMaterial.uniforms.uOrigin.value.set(northwest.x, northwest.z);
		mesh.terrainMaterial.uniforms.uSize.value = southeast.x - northwest.x;
		const entry: ActiveTile = {
			mesh,
			lodMorph: 1,
			appearedAt: now,
			refining: false,
			fadeKey: null,
		};
		let ancestor = parentOf(tile);
		while (ancestor && !previous.has(tileKey(ancestor)))
			ancestor = parentOf(ancestor);
		if (!ancestor) return entry;
		entry.refining = true;
		const imagery = this.findImagery(ancestor, textures);
		if (imagery) {
			const ancestorUv = ancestorUvTransform(tile, imagery.tile);
			const uniforms = mesh.terrainMaterial.uniforms;
			uniforms.uParentImagery.value = imagery.texture;
			uniforms.uParentUv.value.set(
				ancestorUv.offsetU,
				ancestorUv.offsetV,
				ancestorUv.scale,
			);
			entry.fadeKey = tileKey(imagery.tile);
		}
		return entry;
	}
}
