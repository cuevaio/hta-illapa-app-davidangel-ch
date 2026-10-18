import { ArrayCamera, Box3, Matrix4, Ray, Vector2, Vector3 } from "three";
import {
	DEFAULT_HYSTERESIS_RATIO,
	DEFAULT_MAX_PREFETCH_COUNT,
	DEFAULT_PREFETCH_RATIO,
	HALF_CIRCLE_DEG,
	HEIGHT_CACHE_CAPACITY_COUNT,
	HEIGHT_REQUEST_CONCURRENCY_COUNT,
	IMAGERY_CACHE_CAPACITY_COUNT,
	IMAGERY_REQUEST_CONCURRENCY_COUNT,
	LOD_MIN_INTERVAL_MS,
	LOD_TILE_BUDGET_COUNT,
	MAX_ELEVATION_M,
	MAX_MERCATOR_LAT_DEG,
	MAX_SCREEN_SPACE_ERROR_PX,
	MIN_ELEVATION_M,
	RAY_MAX_DISTANCE_M,
	ROOT_ZOOM_LEVEL,
	TRANSITION_FRAME_INTERVAL_MS,
} from "./constants";
import {
	createLocalFrame,
	localToLonLat,
	lonLatToLocal,
} from "./domain/local-frame";
import { selectTiles } from "./domain/lod";
import { intersectHeightfield } from "./domain/raymarch";
import { DecoderPool } from "./infrastructure/decoder-pool";
import { TileLayer } from "./infrastructure/tile-layer";
import {
	ELEVATION_ATTRIBUTION,
	ELEVATION_SOURCE,
	IMAGERY_SOURCE,
	loadHeightTile,
	loadImageryTile,
} from "./infrastructure/tile-sources";
import { LocalCameraView } from "./rendering/camera-view";
import { HeightSampler } from "./rendering/height-sampler";
import { createSharedUniforms } from "./rendering/terrain-material";
import { TerrainRenderer } from "./rendering/terrain-renderer";
import { ThreeFrustum } from "./rendering/three-frustum";
import {
	type HeightResource,
	type ImageryResource,
	TileResourceFactory,
} from "./rendering/tile-resources";
import type { Terrain, TerrainClip, TerrainOptions } from "./types";

export const TERRAIN_ATTRIBUTION = `${ELEVATION_ATTRIBUTION} · ${IMAGERY_SOURCE.attribution}`;

export function createTerrain(options: TerrainOptions): Terrain {
	const frame = createLocalFrame(options.origin.lng, options.origin.lat);
	const shared = createSharedUniforms();
	const terrainRenderer = new TerrainRenderer(frame, shared);
	const { group } = terrainRenderer;
	const resources = new TileResourceFactory(options.renderer);
	const decoderPool = new DecoderPool();
	const cameraView = new LocalCameraView();
	const frustum = new ThreeFrustum();
	const previousClipMatrix = new Matrix4();
	const previousPosition = new Vector3(
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
	);
	const viewportSize = new Vector2();
	const previousViewportSize = new Vector2();
	const localRay = new Ray();
	const clipBox = new Box3();
	const clipEntry = new Vector3();
	let clip: TerrainClip | null = null;
	let dirty = true;
	let disposed = false;
	let lastLodMs = Number.NEGATIVE_INFINITY;
	let refined: ReadonlySet<string> = new Set();
	let wakeTimer: ReturnType<typeof setTimeout> | undefined;
	const markDirty = () => {
		dirty = true;
		options.onTilesLoaded?.();
	};
	const heights = new TileLayer<HeightResource>({
		load: async (tile, signal) =>
			resources.createHeight(await loadHeightTile(decoderPool, tile, signal)),
		maxZoom: ELEVATION_SOURCE.maxZoom,
		capacity: HEIGHT_CACHE_CAPACITY_COUNT,
		maxConcurrent: HEIGHT_REQUEST_CONCURRENCY_COUNT,
		onLoaded: markDirty,
	});
	const imagery = new TileLayer<ImageryResource>({
		load: async (tile, signal) =>
			resources.createImagery(await loadImageryTile(tile, signal)),
		fallback: () => resources.createMissingImagery(),
		capacity: IMAGERY_CACHE_CAPACITY_COUNT,
		maxConcurrent: IMAGERY_REQUEST_CONCURRENCY_COUNT,
		onLoaded: markDirty,
	});
	const sampler = new HeightSampler(
		(key) => heights.get(key),
		ELEVATION_SOURCE.maxZoom,
	);
	const heightAt: Terrain["heightAt"] = (point) => {
		if (disposed) return null;
		const geographicPoint = localToLonLat(frame, point.x, point.z);
		return sampler.sample(geographicPoint.lon, geographicPoint.lat);
	};

	return {
		group,
		heightAt,
		toLocal: (point) => lonLatToLocal(frame, point.lng, point.lat),
		toGeo: (point) => {
			const geographicPoint = localToLonLat(frame, point.x, point.z);
			return { lat: geographicPoint.lat, lng: geographicPoint.lon };
		},
		update(camera) {
			if (disposed) return;
			const nowMs = performance.now();
			group.updateWorldMatrix(true, false);
			// WebXR publishes world matrices independently of the ArrayCamera position and parent.
			if (!(camera instanceof ArrayCamera))
				camera.updateWorldMatrix(true, false);
			cameraView.update(camera, group.matrixWorld);
			options.renderer.getDrawingBufferSize(viewportSize);
			if (
				!previousClipMatrix.equals(cameraView.clipMatrix) ||
				!previousPosition.equals(cameraView.position) ||
				!previousViewportSize.equals(viewportSize)
			)
				dirty = true;
			if (dirty && nowMs - lastLodMs >= LOD_MIN_INTERVAL_MS) {
				previousClipMatrix.copy(cameraView.clipMatrix);
				previousPosition.copy(cameraView.position);
				previousViewportSize.copy(viewportSize);
				lastLodMs = nowMs;
				frustum.update(cameraView.clipMatrix);
				const result = selectTiles({
					cameraPosition: cameraView.position,
					frustum,
					viewportHeightPx: viewportSize.y,
					fovYRadians: cameraView.fovYRadians,
					orthographic: cameraView.orthographic,
					frame,
					rootZoom: ROOT_ZOOM_LEVEL,
					maxZoom: clip ? ELEVATION_SOURCE.maxZoom : IMAGERY_SOURCE.maxZoom,
					bounds: {
						west: -HALF_CIRCLE_DEG,
						east: HALF_CIRCLE_DEG,
						south: -MAX_MERCATOR_LAT_DEG,
						north: MAX_MERCATOR_LAT_DEG,
					},
					clip,
					maxScreenSpaceError:
						MAX_SCREEN_SPACE_ERROR_PX * options.renderer.getPixelRatio(),
					segments: terrainRenderer.segments,
					heightRange: { min: MIN_ELEVATION_M, max: MAX_ELEVATION_M },
					isReady: (key) => heights.isReady(key) && imagery.isReady(key),
					previouslyRefined: refined,
					hysteresis: DEFAULT_HYSTERESIS_RATIO,
					prefetchRatio: DEFAULT_PREFETCH_RATIO,
					maxPrefetch: DEFAULT_MAX_PREFETCH_COUNT,
					maxTiles: LOD_TILE_BUDGET_COUNT,
				});
				refined = result.refined;
				terrainRenderer.setDisplay(
					result.display,
					result.morph,
					{
						height: (key) => heights.get(key),
						imagery: (key) => imagery.get(key),
					},
					cameraView.position,
					nowMs,
				);
				// The whole working set stays cached, not just the displayed tiles: evicting
				// ancestors or ready children of incomplete refinements makes them needed
				// again and loops into constant re-downloads.
				heights.update(result.requests, result.needed);
				// Ancestors still being cross-faded from must not be evicted mid-fade.
				imagery.update(
					result.requests,
					new Set([...result.needed, ...terrainRenderer.fadeSourceKeys]),
				);
				dirty = result.requests.some(
					(request) =>
						!heights.isReady(request.key) || !imagery.isReady(request.key),
				);
			}
			terrainRenderer.update(nowMs);
			if (
				(dirty || terrainRenderer.transitioning) &&
				wakeTimer === undefined &&
				options.onTilesLoaded
			) {
				const delayMs = terrainRenderer.transitioning
					? TRANSITION_FRAME_INTERVAL_MS
					: Math.max(0, LOD_MIN_INTERVAL_MS - (nowMs - lastLodMs));
				wakeTimer = setTimeout(() => {
					wakeTimer = undefined;
					if (!disposed) options.onTilesLoaded?.();
				}, delayMs);
			}
		},
		pick(worldRay) {
			if (disposed) return null;
			group.updateWorldMatrix(true, false);
			cameraView.worldToLocal.copy(group.matrixWorld).invert();
			localRay.copy(worldRay).applyMatrix4(cameraView.worldToLocal);
			if (clip) {
				const halfSizeM = clip.sizeM / 2;
				clipBox.min.set(
					clip.center.x - halfSizeM,
					MIN_ELEVATION_M,
					clip.center.z - halfSizeM,
				);
				clipBox.max.set(
					clip.center.x + halfSizeM,
					MAX_ELEVATION_M,
					clip.center.z + halfSizeM,
				);
				if (!localRay.intersectBox(clipBox, clipEntry)) return null;
				if (!clipBox.containsPoint(localRay.origin))
					localRay.origin.copy(clipEntry);
			}
			const hit = intersectHeightfield(
				localRay.origin,
				localRay.direction,
				(x, z) => {
					if (
						clip &&
						(Math.abs(x - clip.center.x) > clip.sizeM / 2 ||
							Math.abs(z - clip.center.z) > clip.sizeM / 2)
					)
						return null;
					return heightAt({ x, z });
				},
				{ maxDistance: RAY_MAX_DISTANCE_M },
			);
			return hit ? new Vector3(hit.x, hit.y, hit.z) : null;
		},
		setClip(nextClip) {
			if (disposed) return;
			if (nextClip && (!Number.isFinite(nextClip.sizeM) || nextClip.sizeM <= 0))
				throw new Error("Terrain clip sizeM must be positive and finite");
			clip = nextClip
				? { center: { ...nextClip.center }, sizeM: nextClip.sizeM }
				: null;
			shared.uClipEnabled.value = Boolean(clip);
			if (clip) {
				const halfSizeM = clip.sizeM / 2;
				shared.uClipBounds.value.set(
					clip.center.x - halfSizeM,
					clip.center.z - halfSizeM,
					clip.center.x + halfSizeM,
					clip.center.z + halfSizeM,
				);
			}
			markDirty();
		},
		setOpacity(opacity) {
			if (disposed) return;
			if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)
				throw new Error("Terrain opacity must be between 0 and 1");
			terrainRenderer.setOpacity(opacity);
			markDirty();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			clearTimeout(wakeTimer);
			terrainRenderer.dispose();
			heights.clear();
			imagery.clear();
			decoderPool.dispose();
			group.removeFromParent();
		},
	};
}
