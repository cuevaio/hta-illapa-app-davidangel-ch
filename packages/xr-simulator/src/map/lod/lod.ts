import { tilesCovering, type LonLatBox, type TileId } from '../tileMath';
import { boxesOverlap, childrenOf, lonLatBoxWorld, parentOf, tileKey, tileRect, tileWorldBox, type LocalFrame, type Vec3 } from './quadtree';

/**
 * Screen-space-error quadtree selection for the streamed Peru relief, ported from
 * peru-simulator's src/domain/lod.ts (behaviour, not code). Pure; units are scene km.
 */

/** A refined tile coarsens only once its SSE drops below `threshold · DEFAULT_HYSTERESIS`. */
export const DEFAULT_HYSTERESIS = 0.75;
/** Children are prefetched once a tile's SSE exceeds `threshold · DEFAULT_PREFETCH_RATIO`. */
export const DEFAULT_PREFETCH_RATIO = 0.7;
export const DEFAULT_MAX_PREFETCH = 32;

export interface Frustum {
  intersectsBox(min: Vec3, max: Vec3): boolean;
}

/** Plane (nx, ny, nz, d); a point p is inside when n·p + d ≥ 0 (Babylon's convention). */
export type Plane = [number, number, number, number];

/** Union of frusta (one per eye in XR): a box is visible when it is inside any of them. */
export function planesFrustum(frusta: Plane[][]): Frustum {
  return {
    intersectsBox(min, max) {
      return frusta.some((planes) => planes.every(([a, b, c, d]) => {
        // The box corner furthest along the plane normal.
        const px = a >= 0 ? max[0] : min[0];
        const py = b >= 0 ? max[1] : min[1];
        const pz = c >= 0 ? max[2] : min[2];
        return a * px + b * py + c * pz + d >= 0;
      }));
    },
  };
}

export interface LodParams {
  camera: Vec3;
  frustum: Frustum;
  /** Pixels per scene km of error at 1 km: viewportHeightPx / (2·tan(fovY / 2)). */
  sseFactor: number;
  frame: LocalFrame;
  rootZoom: number;
  maxZoom: number;
  /** Tiles that do not intersect it are culled. */
  region: LonLatBox;
  /** Maximum tolerated screen-space error (px) before refining. */
  maxScreenSpaceError: number;
  /** Grid segments per tile edge. */
  segments: number;
  /** Vertical extent [min, max] of a tile (scene km, exaggerated). */
  heightRange: (tile: TileId) => [number, number];
  isReady: (key: string) => boolean;
  /** False when a tile's children cannot be loaded (broken); it then stays a leaf. */
  canRefine?: (tile: TileId) => boolean;
  previouslyRefined?: ReadonlySet<string>;
  hysteresis?: number;
  prefetchRatio?: number;
  maxPrefetch?: number;
  /** Upper bound of the working set; the largest SSEs refine first. */
  maxTiles?: number;
  /**
   * Multiplies the SSE threshold of one tile (default 1). The imagery layer uses it for the
   * levels past the terrain's real max zoom, which refine by imagery texel size.
   */
  thresholdScale?: (tile: TileId) => number;
}

export interface TileRequest {
  tile: TileId;
  key: string;
  /** Lower is more urgent: needed before prefetch, coarse levels first, then nearest. */
  priority: number;
  prefetch?: boolean;
}

export interface LodResult {
  /** Non-overlapping ready tiles to draw. */
  display: TileId[];
  /** Missing needed tiles plus prefetch candidates, by priority. */
  requests: TileRequest[];
  /** Working set: every visited tile (ready or not); caches must keep them. */
  needed: Set<string>;
  /** Tiles that chose to refine; feed back as `previouslyRefined`. */
  refined: Set<string>;
  /** Geomorph factor per displayed tile: 0 = parent's surface, 1 = full detail. */
  morph: Map<string, number>;
  /** Request priority of every needed tile (same scale as `requests`): for other layers (imagery). */
  priority: Map<string, number>;
}

const ZOOM_PRIORITY_WEIGHT = 1e9;
const PREFETCH_PRIORITY_OFFSET = 1e12;

/**
 * Geomorph factor from the parent's SSE: 0 at or below `threshold` (the tile matches the
 * parent's surface, so it appears when the parent refines and disappears when the parent
 * coarsens back below `hysteresis·threshold` without a pop), 1 from `2·hysteresis·threshold`
 * up. A parent's SSE is twice its child's, so the tile is fully detailed before it refines
 * in turn (its own SSE reaching `threshold`).
 */
export function morphFactor(parentSse: number, threshold: number, hysteresis = DEFAULT_HYSTERESIS): number {
  const full = Math.max(2 * hysteresis, 1 + 1e-6) * threshold;
  return Math.min(1, Math.max(0, (parentSse - threshold) / (full - threshold)));
}

interface Box {
  min: Vec3;
  max: Vec3;
}

function distanceToBox(p: Vec3, b: Box): number {
  const dx = Math.max(b.min[0] - p[0], 0, p[0] - b.max[0]);
  const dy = Math.max(b.min[1] - p[1], 0, p[1] - b.max[1]);
  const dz = Math.max(b.min[2] - p[2], 0, p[2] - b.max[2]);
  return Math.hypot(dx, dy, dz);
}

export function selectTiles(p: LodParams): LodResult {
  const region = lonLatBoxWorld(p.region);
  const threshold = p.maxScreenSpaceError;
  const hysteresis = p.hysteresis ?? DEFAULT_HYSTERESIS;
  const prefetchRatio = p.prefetchRatio ?? DEFAULT_PREFETCH_RATIO;
  const scaleOf = p.thresholdScale ?? (() => 1);
  const previouslyRefined = p.previouslyRefined ?? new Set<string>();
  const display: TileId[] = [];
  const requests: TileRequest[] = [];
  const prefetch: TileRequest[] = [];
  const refined = new Set<string>();
  const needed = new Set<string>();
  const morph = new Map<string, number>();
  const priority = new Map<string, number>();

  const boxOf = (t: TileId): Box => {
    const r = tileRect(p.frame, t);
    const [lo, hi] = p.heightRange(t);
    return { min: [r.west, lo, r.north - r.size], max: [r.west + r.size, hi, r.north] };
  };
  const visibleBox = (t: TileId): Box | null => {
    if (!boxesOverlap(tileWorldBox(t), region)) return null;
    const b = boxOf(t);
    return p.frustum.intersectsBox(b.min, b.max) ? b : null;
  };
  const distance = (b: Box) => Math.max(1e-3, distanceToBox(p.camera, b));
  const sseOf = (b: Box) => ((b.max[0] - b.min[0]) / p.segments) * p.sseFactor / distance(b);
  const refinable = (t: TileId) => t.z < p.maxZoom && (p.canRefine?.(t) ?? true);
  const refineThreshold = (t: TileId, key: string) => (previouslyRefined.has(key) ? threshold * hysteresis : threshold) * scaleOf(t);

  const roots = tilesCovering(p.region, p.rootZoom);
  const allowed = p.maxTiles === undefined ? null : budgetRefinements(roots, p.maxTiles, visibleBox, sseOf, refinable, refineThreshold);

  /** Tiles covering this node's visible area, or null when it cannot be covered yet. */
  const visit = (t: TileId, parentSse: number): TileId[] | null => {
    const box = visibleBox(t);
    if (!box) return [];
    const key = tileKey(t);
    needed.add(key);
    const ready = p.isReady(key);
    const urgency = t.z * ZOOM_PRIORITY_WEIGHT + distance(box);
    priority.set(key, urgency);
    if (!ready) requests.push({ tile: t, key, priority: urgency });
    const sse = sseOf(box);
    const refineAt = refineThreshold(t, key);
    const refine = allowed ? allowed.has(key) : refinable(t) && sse > refineAt;
    if (refine) {
      refined.add(key);
      const covered: TileId[] = [];
      let complete = true;
      for (const child of childrenOf(t)) {
        const r = visit(child, sse);
        if (r === null) complete = false;
        else if (complete) covered.push(...r);
      }
      if (complete) return covered;
    } else if (refinable(t) && sse > threshold * prefetchRatio * scaleOf(t)) {
      const imminence = (1 - sse / refineAt) * ZOOM_PRIORITY_WEIGHT;
      for (const child of childrenOf(t)) {
        const cb = visibleBox(child);
        if (cb) prefetch.push({ tile: child, key: tileKey(child), priority: PREFETCH_PRIORITY_OFFSET + imminence + distance(cb), prefetch: true });
      }
    }
    if (!ready) return null;
    const parent = parentOf(t);
    morph.set(key, morphFactor(parentSse, threshold * (parent ? scaleOf(parent) : 1), hysteresis));
    return [t];
  };

  for (const root of roots) {
    const r = visit(root, Infinity);
    if (r) display.push(...r);
  }
  prefetch.sort((a, b) => a.priority - b.priority);
  requests.push(...prefetch.slice(0, p.maxPrefetch ?? DEFAULT_MAX_PREFETCH));
  requests.sort((a, b) => a.priority - b.priority);
  const shown = new Set(display.map(tileKey));
  for (const key of [...morph.keys()]) if (!shown.has(key)) morph.delete(key);
  return { display, requests, needed, refined, morph, priority };
}

/**
 * Chooses which tiles refine so that the visited tree holds at most `maxTiles` tiles,
 * by decreasing SSE; stops at the first tile whose children no longer fit.
 */
function budgetRefinements(
  roots: readonly TileId[],
  maxTiles: number,
  visibleBox: (t: TileId) => Box | null,
  sseOf: (b: Box) => number,
  refinable: (t: TileId) => boolean,
  refineThreshold: (t: TileId, key: string) => number,
): Set<string> {
  const allowed = new Set<string>();
  const candidates: { tile: TileId; key: string; sse: number }[] = [];
  let count = 0;
  const consider = (t: TileId) => {
    const box = visibleBox(t);
    if (!box) return;
    count++;
    if (!refinable(t)) return;
    const key = tileKey(t);
    const sse = sseOf(box);
    if (sse > refineThreshold(t, key)) candidates.push({ tile: t, key, sse });
  };
  for (const r of roots) consider(r);
  while (candidates.length) {
    let best = 0;
    for (let i = 1; i < candidates.length; i++) if (candidates[i].sse > candidates[best].sse) best = i;
    const next = candidates[best];
    candidates[best] = candidates[candidates.length - 1];
    candidates.pop();
    const children = childrenOf(next.tile).filter((c) => visibleBox(c) !== null);
    if (count + children.length > maxTiles) break;
    allowed.add(next.key);
    for (const c of children) consider(c);
  }
  return allowed;
}
