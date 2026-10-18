import { Matrix, Ray, Vector2, Vector3 } from "@babylonjs/core";
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
} from "../constants";
import { HeightSampler } from "../domain/height-sampler";
import {
	createLocalFrame,
	localToLonLat,
	lonLatToLocal,
} from "../domain/local-frame";
import { selectTiles } from "../domain/lod";
import { intersectHeightfield } from "../domain/raymarch";
import { DecoderPool } from "../infrastructure/decoder-pool";
import { TileLayer } from "../infrastructure/tile-layer";
import {
	ELEVATION_SOURCE,
	IMAGERY_SOURCE,
	loadHeightTile,
	loadImageryTile,
} from "../infrastructure/tile-sources";
import type { TerrainClip } from "../types";
import { LocalCameraView } from "./camera-view";
import { createSharedUniforms } from "./terrain-material";
import { TerrainRenderer } from "./terrain-renderer";
import {
	type HeightResource,
	type ImageryResource,
	TileResourceFactory,
} from "./tile-resources";
import type { BabylonTerrain, BabylonTerrainOptions } from "./types";

export { TERRAIN_ATTRIBUTION } from "../infrastructure/tile-sources";
export type { BabylonTerrain, BabylonTerrainOptions } from "./types";

export function createBabylonTerrain(
	options: BabylonTerrainOptions,
): BabylonTerrain {
	const frame = createLocalFrame(options.origin.lng, options.origin.lat);
	const shared = createSharedUniforms();
	const terrainRenderer = new TerrainRenderer(options.scene, frame, shared);
	const { root } = terrainRenderer;
	const resources = new TileResourceFactory(options.scene);
	const decoderPool = new DecoderPool();
	const cameraView = new LocalCameraView();
	const previousClipMatrix = Matrix.Identity();
	const previousPosition = new Vector3(
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
	);
	const viewportSize = new Vector2();
	const previousViewportSize = new Vector2();
	const localRay = new Ray(Vector3.Zero(), Vector3.Zero());
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
		load: async (tile, signal) => {
			const decodedHeight = await loadHeightTile(decoderPool, tile, signal);
			if (signal.aborted) throw new DOMException("Aborted", "AbortError");
			return resources.createHeight(decodedHeight);
		},
		maxZoom: ELEVATION_SOURCE.maxZoom,
		capacity: HEIGHT_CACHE_CAPACITY_COUNT,
		maxConcurrent: HEIGHT_REQUEST_CONCURRENCY_COUNT,
		onLoaded: markDirty,
	});
	const imagery = new TileLayer<ImageryResource>({
		load: async (tile, signal) => {
			const bitmap = await loadImageryTile(tile, signal);
			if (signal.aborted) {
				bitmap.close();
				throw new DOMException("Aborted", "AbortError");
			}
			return resources.createImagery(bitmap);
		},
		fallback: () => resources.createMissingImagery(),
		capacity: IMAGERY_CACHE_CAPACITY_COUNT,
		maxConcurrent: IMAGERY_REQUEST_CONCURRENCY_COUNT,
		onLoaded: markDirty,
	});
	const sampler = new HeightSampler(
		(key) => heights.get(key),
		ELEVATION_SOURCE.maxZoom,
	);
	const heightAt: BabylonTerrain["heightAt"] = (point) => {
		if (disposed) return null;
		const geographicPoint = localToLonLat(frame, point.x, point.z);
		return sampler.sample(geographicPoint.lon, geographicPoint.lat);
	};

	return {
		root,
		heightAt,
		toLocal: (point) => lonLatToLocal(frame, point.lng, point.lat),
		toGeo: (point) => {
			const geographicPoint = localToLonLat(frame, point.x, point.z);
			return { lat: geographicPoint.lat, lng: geographicPoint.lon };
		},
		update(camera) {
			if (disposed) return;
			const nowMs = performance.now();
			root.computeWorldMatrix(true);
			cameraView.update(camera, root.getWorldMatrix());
			viewportSize.set(
				options.scene.getEngine().getRenderWidth(),
				options.scene.getEngine().getRenderHeight(),
			);

			if (
				!previousClipMatrix.equals(cameraView.clipMatrix) ||
				!previousPosition.equals(cameraView.position) ||
				!previousViewportSize.equals(viewportSize)
			)
				dirty = true;
			if (dirty && nowMs - lastLodMs >= LOD_MIN_INTERVAL_MS) {
				previousClipMatrix.copyFrom(cameraView.clipMatrix);
				previousPosition.copyFrom(cameraView.position);
				previousViewportSize.copyFrom(viewportSize);
				lastLodMs = nowMs;
				const result = selectTiles({
					cameraPosition: cameraView.position,
					frustum: cameraView,
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
						MAX_SCREEN_SPACE_ERROR_PX /
						options.scene.getEngine().getHardwareScalingLevel(),
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
			root.computeWorldMatrix(true);
			root.getWorldMatrix().invertToRef(cameraView.worldToLocal);
			Ray.TransformToRef(worldRay, cameraView.worldToLocal, localRay);
			if (clip) {
				const halfSizeM = clip.sizeM / 2;
				let entryDistanceM = 0;
				let exitDistanceM = RAY_MAX_DISTANCE_M;
				const bounds = [
					{
						origin: localRay.origin.x,
						direction: localRay.direction.x,
						minimum: clip.center.x - halfSizeM,
						maximum: clip.center.x + halfSizeM,
					},
					{
						origin: localRay.origin.y,
						direction: localRay.direction.y,
						minimum: MIN_ELEVATION_M,
						maximum: MAX_ELEVATION_M,
					},
					{
						origin: localRay.origin.z,
						direction: localRay.direction.z,
						minimum: clip.center.z - halfSizeM,
						maximum: clip.center.z + halfSizeM,
					},
				];
				for (const axis of bounds) {
					if (axis.direction === 0) {
						if (axis.origin < axis.minimum || axis.origin > axis.maximum)
							return null;
						continue;
					}
					const nearDistanceM = (axis.minimum - axis.origin) / axis.direction;
					const farDistanceM = (axis.maximum - axis.origin) / axis.direction;
					entryDistanceM = Math.max(
						entryDistanceM,
						Math.min(nearDistanceM, farDistanceM),
					);
					exitDistanceM = Math.min(
						exitDistanceM,
						Math.max(nearDistanceM, farDistanceM),
					);
					if (entryDistanceM > exitDistanceM) return null;
				}
				localRay.origin.addInPlace(localRay.direction.scale(entryDistanceM));
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
			terrainRenderer.update(performance.now());
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
			root.parent = null;
		},
	};
}
