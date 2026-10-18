import type { DeviceClass } from "../../platform/device";

/** Streaming/LOD budgets of the Peru relief per device class. */
export interface LodProfile {
	id: "desktop" | "quest";
	/** Grid segments per tile edge (shared geometry). */
	segments: number;
	/** Refine above this screen-space error (px of the render target / eye buffer). */
	maxScreenSpaceError: number;
	/** Working-set cap (tiles visited by the quadtree). */
	maxTiles: number;
	/** Height tiles kept in the LRU (GPU textures); always above maxTiles. */
	cacheCapacity: number;
	/** Tile requests in flight. */
	maxConcurrent: number;
	maxPrefetch: number;
	/** Height textures uploaded per frame at most. */
	uploadsPerFrame: number;
	decoders: number;
	/** Minimum time between LOD selections (ms); also recomputed only on camera/viewport/tile changes. */
	lodIntervalMs: number;
	/** Satellite imagery texture side per tile: 512 = 2×2 provider tiles of z+1, 256 = one tile of z (S7). */
	imageryPx: 512 | 256;
	/** Imagery textures kept in their LRU (512 px RGBA + mips ≈ 1.4 MB, 256 px ≈ 0.35 MB). */
	imageryCacheCapacity: number;
	/** Imagery tiles in flight (each is 4 provider requests at 512 px, 1 at 256 px). */
	imageryMaxConcurrent: number;
}

export const LOD_PROFILES: Record<LodProfile["id"], LodProfile> = {
	// As peru-simulator: SSE 4 px, 300 tiles, 400 cached, 8 in flight.
	desktop: {
		id: "desktop",
		segments: 64,
		maxScreenSpaceError: 4,
		maxTiles: 300,
		cacheCapacity: 400,
		maxConcurrent: 8,
		maxPrefetch: 32,
		uploadsPerFrame: 4,
		decoders: 3,
		lodIntervalMs: 50,
		imageryPx: 512,
		imageryCacheCapacity: 320,
		imageryMaxConcurrent: 4,
	},
	// Quest 72 Hz on WebGL2: half the triangles per tile, fewer tiles, one upload per frame.
	quest: {
		id: "quest",
		segments: 32,
		maxScreenSpaceError: 8,
		maxTiles: 120,
		cacheCapacity: 180,
		maxConcurrent: 4,
		maxPrefetch: 8,
		uploadsPerFrame: 1,
		decoders: 2,
		lodIntervalMs: 100,
		// 256 px imagery: a quarter of the texture memory (~50 MB for the whole cache).
		imageryPx: 256,
		imageryCacheCapacity: 150,
		imageryMaxConcurrent: 4,
	},
};

/** Quest, phones and tablets get the light profile; `?lod=quest|desktop` overrides it. */
export function pickLodProfile(device: DeviceClass, search = ""): LodProfile {
	const forced = new URLSearchParams(search).get("lod");
	if (forced === "quest" || forced === "desktop") return LOD_PROFILES[forced];
	return device === "desktop" ? LOD_PROFILES.desktop : LOD_PROFILES.quest;
}
