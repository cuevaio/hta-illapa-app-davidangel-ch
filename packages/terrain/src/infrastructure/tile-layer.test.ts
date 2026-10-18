const PERU_BOUNDS = { west: -81.4, south: -18.4, east: -68.6, north: 0 };

import { describe, expect, it, vi } from "vitest";
import { createLocalFrame, lonLatToLocal } from "../domain/local-frame";
import type { TileRequest } from "../domain/lod";
import { type LodParams, selectTiles } from "../domain/lod";
import { tileKey } from "../domain/tile-math";
import type { TileId } from "../domain/types";
import { TileLayer } from "./tile-layer";

const flush = () => new Promise((request) => setTimeout(request, 0));

function tileRequest(
	z: number,
	x: number,
	y: number,
	priority = z,
): TileRequest {
	const tile: TileId = { z, x, y };
	return { tile, key: tileKey(tile), priority };
}

function resource(name: string) {
	return { name, dispose: vi.fn() };
}

describe("TileLayer", () => {
	it("loads requested tiles and reports them ready", async () => {
		const onLoaded = vi.fn();
		const layer = new TileLayer({
			load: async (tile) => resource(tileKey(tile)),
			capacity: 10,
			maxConcurrent: 4,
			onLoaded,
		});
		layer.update([tileRequest(5, 8, 16)], new Set());
		expect(layer.isReady("5/8/16")).toBe(false);
		await flush();
		expect(layer.isReady("5/8/16")).toBe(true);
		expect(layer.get("5/8/16")?.name).toBe("5/8/16");
		expect(onLoaded).toHaveBeenCalledTimes(1);
	});

	it("evicts least recently used tiles but keeps displayed ones, disposing evicted resources", async () => {
		const made: ReturnType<typeof resource>[] = [];
		const layer = new TileLayer({
			load: async (tile) => {
				const request = resource(tileKey(tile));
				made.push(request);
				return request;
			},
			capacity: 2,
			maxConcurrent: 4,
		});
		layer.update([tileRequest(5, 0, 0), tileRequest(5, 1, 0)], new Set());
		await flush();
		layer.update([tileRequest(5, 2, 0)], new Set(["5/0/0"]));
		await flush();
		expect(layer.isReady("5/0/0")).toBe(true);
		expect(layer.isReady("5/1/0")).toBe(false);
		expect(
			made.find((mercator) => mercator.name === "5/1/0")?.dispose,
		).toHaveBeenCalledTimes(1);
		expect(layer.stats.cached).toBe(2);
	});

	it("cancels requests that are no longer wanted", async () => {
		const signals: AbortSignal[] = [];
		const layer = new TileLayer({
			load: (_tile, signal) => {
				signals.push(signal);
				return new Promise<never>(() => {});
			},
			capacity: 10,
			maxConcurrent: 4,
		});
		layer.update([tileRequest(5, 0, 0)], new Set());
		layer.update([], new Set());
		expect(signals[0]?.aborted).toBe(true);
		expect(layer.stats.inFlight).toBe(0);
	});

	it("uses the fallback after repeated failures so the tile does not block forever", async () => {
		let now = 0;
		const layer = new TileLayer({
			load: async () => {
				throw new Error("network");
			},
			fallback: (tile) => resource(`fallback ${tileKey(tile)}`),
			capacity: 10,
			maxConcurrent: 4,
			maxAttempts: 2,
			retryDelayMs: 1000,
			now: () => now,
		});
		layer.update([tileRequest(5, 0, 0)], new Set());
		await flush();
		expect(layer.isReady("5/0/0")).toBe(false);
		layer.update([tileRequest(5, 0, 0)], new Set());
		expect(layer.stats.inFlight).toBe(0);
		now = 2000;
		layer.update([tileRequest(5, 0, 0)], new Set());
		await flush();
		expect(layer.get("5/0/0")?.name).toBe("fallback 5/0/0");
	});

	it("only prefetches into cache headroom left after displayed and needed tiles", async () => {
		const loaded: string[] = [];
		const layer = new TileLayer({
			load: (tile) => {
				loaded.push(tileKey(tile));
				return new Promise<never>(() => {});
			},
			capacity: 4,
			maxConcurrent: 10,
		});
		const prefetch = (x: number, priority: number): TileRequest => ({
			...tileRequest(6, x, 0, priority),
			prefetch: true,
		});
		// 2 displayed + 1 needed leaves room for exactly one prefetch, the most urgent one.
		layer.update(
			[
				tileRequest(5, 0, 0),
				prefetch(1, 101),
				prefetch(0, 100),
				prefetch(2, 102),
			],
			new Set(["5/1/0", "5/2/0"]),
		);
		expect(loaded.sort()).toEqual(["5/0/0", "6/0/0"]);
	});

	it("schedules every prefetch request when the cache has room", () => {
		const loaded: string[] = [];
		const layer = new TileLayer({
			load: (tile) => {
				loaded.push(tileKey(tile));
				return new Promise<never>(() => {});
			},
			capacity: 10,
			maxConcurrent: 10,
		});
		layer.update(
			[
				{ ...tileRequest(6, 0, 0), prefetch: true },
				{ ...tileRequest(6, 1, 0), prefetch: true },
			],
			new Set(),
		);
		expect(loaded.sort()).toEqual(["6/0/0", "6/1/0"]);
	});

	it("does not prefetch while needed tiles saturate the request slots", () => {
		const loaded: string[] = [];
		const layer = new TileLayer({
			load: (tile) => {
				loaded.push(tileKey(tile));
				return new Promise<never>(() => {});
			},
			capacity: 100,
			maxConcurrent: 2,
		});
		layer.update(
			[
				tileRequest(5, 0, 0),
				tileRequest(5, 1, 0),
				{ ...tileRequest(6, 0, 0, 1e12), prefetch: true },
			],
			new Set(),
		);
		expect(loaded.sort()).toEqual(["5/0/0", "5/1/0"]);
		expect(layer.stats.queued).toBe(0);
	});

	it("disposes everything on clear", async () => {
		const request = resource("a");
		const layer = new TileLayer({
			load: async () => request,
			capacity: 10,
			maxConcurrent: 4,
		});
		layer.update([tileRequest(5, 0, 0)], new Set());
		await flush();
		layer.clear();
		expect(request.dispose).toHaveBeenCalledTimes(1);
		expect(layer.isReady("5/0/0")).toBe(false);
	});

	it("never evicts retained working-set tiles, even when they are not displayed", async () => {
		const made: ReturnType<typeof resource>[] = [];
		const layer = new TileLayer({
			load: async (tile) => {
				const request = resource(tileKey(tile));
				made.push(request);
				return request;
			},
			capacity: 3,
			maxConcurrent: 4,
		});
		layer.update(
			[tileRequest(5, 0, 0), tileRequest(5, 1, 0), tileRequest(5, 2, 0)],
			new Set(),
		);
		await flush();
		// 5/1/0 and 5/2/0 are ready but undisplayed children of an incomplete refinement.
		layer.update([tileRequest(5, 3, 0)], new Set(["5/0/0", "5/1/0"]));
		await flush();
		expect(layer.isReady("5/0/0")).toBe(true);
		expect(layer.isReady("5/1/0")).toBe(true);
		expect(layer.isReady("5/2/0")).toBe(false);
		expect(
			made
				.filter((mercator) => mercator.dispose.mock.calls.length > 0)
				.map((mercator) => mercator.name),
		).toEqual(["5/2/0"]);
	});

	it("does not download needed tiles beyond the capacity left by retained tiles", async () => {
		let loads = 0;
		const layer = new TileLayer({
			load: async (tile) => {
				loads++;
				return resource(tileKey(tile));
			},
			capacity: 3,
			maxConcurrent: 8,
		});
		const working = [0, 1, 2, 3, 4].map((x) => tileRequest(5, x, 0));
		for (let tick = 0; tick < 10; tick++) {
			const missing = working.filter((request) => !layer.isReady(request.key));
			layer.update(missing, new Set(working.map((request) => request.key)));
			await flush();
		}
		expect(loads).toBe(3);
		expect(layer.stats.cached).toBe(3);
	});

	it("settles to zero new requests under a stable LOD whose working set exceeds the cache", async () => {
		const frame = createLocalFrame(-75, -9.5);
		const localPoint = lonLatToLocal(frame, -72.545, -13.163);
		const capacity = 120;
		let loads = 0;
		const layer = new TileLayer({
			load: async (tile) => {
				loads++;
				return resource(tileKey(tile));
			},
			capacity,
			maxConcurrent: 8,
		});
		let refined: ReadonlySet<string> = new Set();
		const lodParams = (maxTiles?: number): LodParams => ({
			cameraPosition: { x: localPoint.x, y: 4000, z: localPoint.z },
			frustum: { intersectsBox: () => true },
			viewportHeightPx: 1000,
			fovYRadians: Math.PI / 3,
			frame,
			rootZoom: 5,
			maxZoom: 14,
			bounds: PERU_BOUNDS,
			maxScreenSpaceError: 4,
			segments: 64,
			heightRange: { min: -500, max: 7000 },
			isReady: (key) => layer.isReady(key),
			previouslyRefined: refined,
			maxTiles,
		});
		expect(
			selectTiles({ ...lodParams(), isReady: () => true }).needed.size,
		).toBeGreaterThan(capacity);
		const tick = async (maxTiles?: number) => {
			const result = selectTiles(lodParams(maxTiles));
			refined = result.refined;
			layer.update(result.requests, result.needed);
			await flush();
		};
		// Without a LOD budget the layer itself must stop downloading what cannot fit.
		for (let index = 0; index < 80; index++) await tick();
		let settled = loads;
		for (let index = 0; index < 30; index++) await tick();
		expect(loads).toBe(settled);
		expect(layer.stats.cached).toBeLessThanOrEqual(capacity);
		// With a budget the working set fits and the view still settles.
		for (let index = 0; index < 80; index++) await tick(capacity - 10);
		settled = loads;
		for (let index = 0; index < 30; index++) await tick(capacity - 10);
		expect(loads).toBe(settled);
		expect(layer.stats.cached).toBeLessThanOrEqual(capacity);
	});
});
