import {
	DEFAULT_HYSTERESIS_RATIO,
	DEFAULT_MAX_PREFETCH_COUNT,
	DEFAULT_PREFETCH_RATIO,
	MIN_LOD_DISTANCE_M,
	MORPH_THRESHOLD_EPSILON_RATIO,
	PREFETCH_PRIORITY_OFFSET_RATIO,
	ZOOM_PRIORITY_WEIGHT_RATIO,
} from "../constants";
import type { TerrainClip } from "../types";
import { type LocalFrame, mercatorToLocal } from "./local-frame";
import {
	childrenOf,
	lonLatToMercator,
	tileBoundsMercator,
	tileKey,
	tilesCovering,
} from "./tile-math";
import type { FrustumLike, LonLatBounds, TileId, Vec3 } from "./types";

export interface LodParams {
	clip?: TerrainClip | null;
	orthographic?: boolean;
	cameraPosition: Vec3;
	frustum: FrustumLike;
	viewportHeightPx: number;
	fovYRadians: number;
	frame: LocalFrame;
	/** Coarsest zoom of the quadtree roots. */
	rootZoom: number;
	maxZoom: number;
	/** Region of interest; tiles that do not intersect it are culled. */
	bounds: LonLatBounds;
	/** Maximum tolerated screen-space error in pixels before refining. */
	maxScreenSpaceError: number;
	/** Grid segments per tile edge in the rendered mesh. */
	segments: number;
	/** Vertical extent of terrain in local units (true metres). */
	heightRange: { min: number; max: number };
	/** Whether a tile's data is loaded and can be displayed. */
	isReady: (key: string) => boolean;
	/** Tiles that were refined in the previous selection (`LodResult.refined`). */
	previouslyRefined?: ReadonlySet<string>;
	/** Fraction of the threshold below which a refined tile coarsens again. */
	hysteresis?: number;
	/** Fraction of the threshold above which children are prefetched. */
	prefetchRatio?: number;
	maxPrefetch?: number;
	/**
	 * Upper bound on the working set (`LodResult.needed`). When refining
	 * everything would exceed it, the tiles with the largest screen-space error
	 * refine first and the rest stay coarser, so the working set always fits
	 * the tile caches instead of thrashing them.
	 */
	maxTiles?: number;
}

export interface TileRequest {
	tile: TileId;
	key: string;
	/** Lower values are more urgent: needed before prefetch, coarse levels first, then by distance. */
	priority: number;
	/**
	 * True when the tile is only loaded ahead of time and not needed for display
	 * yet. Prefetch requests may already be ready: caches keep the ones that fit
	 * instead of evicting and fetching them again.
	 */
	prefetch?: boolean;
}

export interface LodResult {
	/** Non-overlapping set of ready tiles to render. */
	display: TileId[];
	/** Needed tiles that are not ready yet plus the prefetch candidates, sorted by priority. */
	requests: TileRequest[];
	/**
	 * Working set: every visited tile (displayed, ancestors of displayed tiles
	 * and children of refinements that are still incomplete), ready or not.
	 * Caches must keep these tiles; evicting one forces it to be requested again.
	 */
	needed: Set<string>;
	/** Tiles that chose to refine; feed back as `previouslyRefined` next time. */
	refined: Set<string>;
	/** Geomorph factor per displayed tile key: 0 = parent's surface, 1 = full detail. */
	morph: Map<string, number>;
}

/**
 * Geomorph factor of a tile from its parent's screen-space error. The tile
 * appears when the parent crosses `threshold` (factor 0, matching the parent
 * surface) and reaches full detail at `2 * hysteresis * threshold`. Because a
 * parent's SSE is at least twice its child's, the tile is fully detailed both
 * when it refines (SSE = threshold) and when it coarsens back
 * (SSE = hysteresis * threshold), so neither transition pops.
 */
export function morphFactor(
	parentSse: number,
	threshold: number,
	hysteresis = DEFAULT_HYSTERESIS_RATIO,
): number {
	const full =
		Math.max(2 * hysteresis, 1 + MORPH_THRESHOLD_EPSILON_RATIO) * threshold;
	const morph = (parentSse - threshold) / (full - threshold);
	return Math.min(1, Math.max(0, morph));
}

/** Screen-space error in pixels of a tile's mesh as seen from the camera. */
export function screenSpaceError(tile: TileId, params: LodParams): number {
	const box = tileBox(tile, params);
	return sseOf(box, params);
}

interface Box {
	min: Vec3;
	max: Vec3;
}

function tileBox(tile: TileId, params: LodParams): Box {
	const mercator = tileBoundsMercator(tile);
	const northwest = mercatorToLocal(params.frame, mercator.minX, mercator.maxY);
	const southeast = mercatorToLocal(params.frame, mercator.maxX, mercator.minY);
	return {
		min: { x: northwest.x, y: params.heightRange.min, z: northwest.z },
		max: { x: southeast.x, y: params.heightRange.max, z: southeast.z },
	};
}

function boxDistance(params: LodParams, box: Box): number {
	const distanceX = Math.max(
		box.min.x - params.cameraPosition.x,
		0,
		params.cameraPosition.x - box.max.x,
	);
	const distanceY = Math.max(
		box.min.y - params.cameraPosition.y,
		0,
		params.cameraPosition.y - box.max.y,
	);
	const distanceZ = Math.max(
		box.min.z - params.cameraPosition.z,
		0,
		params.cameraPosition.z - box.max.z,
	);
	return Math.max(
		MIN_LOD_DISTANCE_M,
		Math.hypot(distanceX, distanceY, distanceZ),
	);
}

function sseOf(box: Box, params: LodParams): number {
	// Pixels per local unit of error at distance 1.
	const sseFactor =
		params.viewportHeightPx / (2 * Math.tan(params.fovYRadians / 2));
	const geometricError = (box.max.x - box.min.x) / params.segments;
	return (
		(geometricError * sseFactor) /
		(params.orthographic ? 1 : boxDistance(params, box))
	);
}

export function selectTiles(params: LodParams): LodResult {
	const regionMercator = {
		min: lonLatToMercator(params.bounds.west, params.bounds.south),
		max: lonLatToMercator(params.bounds.east, params.bounds.north),
	};
	const threshold = params.maxScreenSpaceError;
	const hysteresis = params.hysteresis ?? DEFAULT_HYSTERESIS_RATIO;
	const prefetchThreshold =
		threshold * (params.prefetchRatio ?? DEFAULT_PREFETCH_RATIO);
	const previouslyRefined = params.previouslyRefined ?? new Set<string>();
	const display: TileId[] = [];
	const requests: TileRequest[] = [];
	const prefetch: TileRequest[] = [];
	const refined = new Set<string>();
	const needed = new Set<string>();
	const morph = new Map<string, number>();

	/** Box of a tile when it intersects both the region and the frustum, else null. */
	const visibleBox = (tile: TileId): Box | null => {
		const mercator = tileBoundsMercator(tile);
		if (
			mercator.maxX <= regionMercator.min.x ||
			mercator.minX >= regionMercator.max.x ||
			mercator.maxY <= regionMercator.min.y ||
			mercator.minY >= regionMercator.max.y
		) {
			return null;
		}
		const box = tileBox(tile, params);
		if (params.clip) {
			const halfSizeM = params.clip.sizeM / 2;
			if (
				box.max.x <= params.clip.center.x - halfSizeM ||
				box.min.x >= params.clip.center.x + halfSizeM ||
				box.max.z <= params.clip.center.z - halfSizeM ||
				box.min.z >= params.clip.center.z + halfSizeM
			)
				return null;
		}
		return params.frustum.intersectsBox(box.min, box.max) ? box : null;
	};

	const refineThreshold = (key: string) =>
		previouslyRefined.has(key) ? threshold * hysteresis : threshold;
	const roots = tilesCovering(params.bounds, params.rootZoom);
	const allowed =
		params.maxTiles === undefined
			? null
			: budgetRefinements(
					roots,
					params,
					visibleBox,
					refineThreshold,
					params.maxTiles,
				);

	/** Returns the tiles that fully cover this node's visible area, or null if it cannot be covered yet. */
	const visit = (tile: TileId, parentSse: number): TileId[] | null => {
		const box = visibleBox(tile);
		if (!box) return [];

		const key = tileKey(tile);
		needed.add(key);
		const ready = params.isReady(key);
		const distance = boxDistance(params, box);
		if (!ready)
			requests.push({
				tile,
				key,
				priority: tile.z * ZOOM_PRIORITY_WEIGHT_RATIO + distance,
			});

		const sse = sseOf(box, params);
		const refineAt = refineThreshold(key);
		const refine = allowed
			? allowed.has(key)
			: tile.z < params.maxZoom && (Boolean(params.clip) || sse > refineAt);
		if (refine) {
			refined.add(key);
			const covered: TileId[] = [];
			let complete = true;
			for (const child of childrenOf(tile)) {
				const coverage = visit(child, sse);
				if (coverage === null) complete = false;
				else if (complete) covered.push(...coverage);
			}
			if (complete) return covered;
		} else if (tile.z < params.maxZoom && sse > prefetchThreshold) {
			// Most imminent refinements first: the closer the SSE is to the threshold, the sooner.
			const imminence = (1 - sse / refineAt) * ZOOM_PRIORITY_WEIGHT_RATIO;
			for (const child of childrenOf(tile)) {
				const childBox = visibleBox(child);
				if (!childBox) continue;
				const childKey = tileKey(child);
				const priority =
					PREFETCH_PRIORITY_OFFSET_RATIO +
					imminence +
					boxDistance(params, childBox);
				prefetch.push({ tile: child, key: childKey, priority, prefetch: true });
			}
		}
		if (!ready) return null;
		morph.set(
			key,
			params.clip ? 1 : morphFactor(parentSse, threshold, hysteresis),
		);
		return [tile];
	};

	for (const root of roots) {
		const coverage = visit(root, Number.POSITIVE_INFINITY);
		if (coverage) display.push(...coverage);
	}
	prefetch.sort(
		(firstRequest, secondRequest) =>
			firstRequest.priority - secondRequest.priority,
	);
	// Ready candidates are included so caches keep them; the limit bounds the prefetched set.
	requests.push(
		...prefetch.slice(0, params.maxPrefetch ?? DEFAULT_MAX_PREFETCH_COUNT),
	);
	requests.sort(
		(firstRequest, secondRequest) =>
			firstRequest.priority - secondRequest.priority,
	);
	// Drop morph entries of ready tiles whose covering was discarded by an incomplete parent.
	const shown = new Set(display.map(tileKey));
	for (const key of [...morph.keys()]) if (!shown.has(key)) morph.delete(key);
	return { display, requests, needed, refined, morph };
}

/**
 * Chooses which tiles refine so that the visited tree (roots plus the visible
 * children of every refined tile) holds at most `maxTiles` tiles. Tiles are
 * refined in order of decreasing screen-space error; refinement stops at the
 * first tile whose children no longer fit, keeping detail uniform.
 */
function budgetRefinements(
	roots: readonly TileId[],
	params: LodParams,
	visibleBox: (tile: TileId) => Box | null,
	refineThreshold: (key: string) => number,
	maxTiles: number,
): Set<string> {
	const allowed = new Set<string>();
	const candidates: { tile: TileId; key: string; sse: number }[] = [];
	let count = 0;
	const consider = (tile: TileId): void => {
		const box = visibleBox(tile);
		if (!box) return;
		count++;
		if (tile.z >= params.maxZoom) return;
		const key = tileKey(tile);
		const sse = sseOf(box, params);
		if (params.clip || sse > refineThreshold(key))
			candidates.push({ tile, key, sse });
	};
	for (const root of roots) consider(root);
	while (candidates.length > 0) {
		let bestIndex = 0;
		let next = candidates[0];
		if (!next) break;
		for (const [candidateIndex, candidate] of candidates.entries()) {
			if (candidate.sse > next.sse) {
				bestIndex = candidateIndex;
				next = candidate;
			}
		}
		candidates.splice(bestIndex, 1);
		const children = childrenOf(next.tile).filter(
			(child) => visibleBox(child) !== null,
		);
		if (count + children.length > maxTiles) break;
		allowed.add(next.key);
		for (const child of children) consider(child);
	}
	return allowed;
}
