import { MAX_TILE_ATTEMPTS_COUNT, TILE_RETRY_DELAY_MS } from "../constants";
import type { TileRequest } from "../domain/lod";
import { ancestorAtZoom, parseTileKey, tileKey } from "../domain/tile-math";
import type { TileId } from "../domain/types";
import { LruCache } from "./lru-cache";
import { RequestScheduler } from "./request-scheduler";

export interface Disposable {
	dispose(): void;
}

export interface TileLayerOptions<Resource extends Disposable> {
	load: (tile: TileId, signal: AbortSignal) => Promise<Resource>;
	/** Resource used after `maxAttempts` failures, so a broken tile never blocks refinement forever. */
	fallback?: (tile: TileId) => Resource;
	maxZoom?: number;
	capacity: number;
	maxConcurrent: number;
	maxAttempts?: number;
	retryDelayMs?: number;
	onLoaded?: (key: string) => void;
	now?: () => number;
}

export interface TileLayerStats {
	cached: number;
	queued: number;
	inFlight: number;
}

interface Failure {
	attempts: number;
	retryAt: number;
}

/** One streamed tile dataset: scheduler + bounded LRU cache of disposable resources. */
export class TileLayer<Resource extends Disposable> {
	private readonly scheduler: RequestScheduler;
	private readonly cache: LruCache<string, Resource>;
	private readonly failures = new Map<string, Failure>();
	private pinned: ReadonlySet<string> = new Set();
	private generation = 0;
	private readonly now: () => number;

	constructor(private readonly options: TileLayerOptions<Resource>) {
		this.scheduler = new RequestScheduler({
			maxConcurrent: options.maxConcurrent,
		});
		this.cache = new LruCache<string, Resource>({
			capacity: options.capacity,
			onEvict: (_key, value) => value.dispose(),
			isPinned: (key) => this.pinned.has(key),
		});
		this.now = options.now ?? (() => performance.now());
	}

	get stats(): TileLayerStats {
		return { cached: this.cache.size, ...this.scheduler.stats };
	}

	isReady(key: string): boolean {
		return this.cache.has(this.sourceKey(key));
	}

	get(key: string): Resource | undefined {
		return this.cache.peek(this.sourceKey(key));
	}

	/**
	 * Keeps the working set and streams what is missing.
	 *
	 * `retain` is the working set (displayed tiles, their ancestors, children of
	 * incomplete refinements and anything else the caller still uses): cached
	 * retained tiles are never evicted. Needed requests are only downloaded
	 * into the capacity left beside them, so a working set larger than the
	 * cache stops downloading instead of evicting and re-requesting itself.
	 * Prefetch requests use spare request slots and the remaining headroom;
	 * already cached prefetch tiles count toward that headroom and are kept.
	 * Requests no longer wanted are cancelled.
	 */
	update(requests: readonly TileRequest[], retain: ReadonlySet<string>): void {
		let sourceRequests = requests;
		const retainedSourceKeys = new Set(
			[...retain].map((key) => this.sourceKey(key)),
		);
		if (this.options.maxZoom !== undefined) {
			const deduplicatedRequests = new Map<string, TileRequest>();
			for (const request of requests) {
				const tile = ancestorAtZoom(request.tile, this.options.maxZoom);
				const key = tileKey(tile);
				const existingRequest = deduplicatedRequests.get(key);
				if (
					!existingRequest ||
					(existingRequest.prefetch && !request.prefetch) ||
					(Boolean(existingRequest.prefetch) === Boolean(request.prefetch) &&
						request.priority < existingRequest.priority)
				)
					deduplicatedRequests.set(key, { ...request, tile, key });
			}
			sourceRequests = [...deduplicatedRequests.values()];
		}
		const pinned = new Set<string>();
		for (const key of retainedSourceKeys) {
			if (this.cache.get(key) !== undefined) pinned.add(key);
		}

		const blocked = (key: string) => {
			const failure = this.failures.get(key);
			return failure !== undefined && failure.retryAt > this.now();
		};
		const missing = sourceRequests
			.filter(
				(request) =>
					!request.prefetch &&
					!this.cache.has(request.key) &&
					!blocked(request.key),
			)
			.sort(
				(firstRequest, secondRequest) =>
					firstRequest.priority - secondRequest.priority,
			);
		const needed = missing.slice(
			0,
			Math.max(0, this.options.capacity - pinned.size),
		);

		// Uncached retained tiles still claim their future cache slot.
		const reserved = new Set([
			...retainedSourceKeys,
			...needed.map((request) => request.key),
		]).size;
		const prefetchBudget =
			missing.length >= this.options.maxConcurrent
				? 0
				: Math.max(0, this.options.capacity - reserved);
		const prefetch: TileRequest[] = [];
		const candidates = sourceRequests
			.filter((request) => request.prefetch && !pinned.has(request.key))
			.sort(
				(firstRequest, secondRequest) =>
					firstRequest.priority - secondRequest.priority,
			);
		for (const request of candidates.slice(0, prefetchBudget)) {
			if (this.cache.get(request.key) !== undefined) pinned.add(request.key);
			else if (!blocked(request.key)) prefetch.push(request);
		}
		this.pinned = pinned;

		const wanted = new Set<string>();
		for (const request of [...needed, ...prefetch]) {
			wanted.add(request.key);
			this.scheduler.schedule(request.key, request.priority, (signal) =>
				this.fetch(request.tile, request.key, signal),
			);
		}
		this.scheduler.retainOnly(wanted);
	}

	/** Cancels all requests and disposes every cached resource. */
	clear(): void {
		this.generation++;
		this.scheduler.cancelAll();
		this.failures.clear();
		this.pinned = new Set();
		this.cache.clear();
	}

	private sourceKey(key: string): string {
		return this.options.maxZoom === undefined
			? key
			: tileKey(ancestorAtZoom(parseTileKey(key), this.options.maxZoom));
	}

	private async fetch(
		tile: TileId,
		key: string,
		signal: AbortSignal,
	): Promise<void> {
		const generation = this.generation;
		try {
			const resource = await this.options.load(tile, signal);
			if (signal.aborted || generation !== this.generation) {
				resource.dispose();
				return;
			}
			this.failures.delete(key);
			this.store(key, resource);
		} catch {
			if (signal.aborted || generation !== this.generation) return;
			const attempts = (this.failures.get(key)?.attempts ?? 0) + 1;
			const maxAttempts = this.options.maxAttempts ?? MAX_TILE_ATTEMPTS_COUNT;
			if (attempts >= maxAttempts && this.options.fallback) {
				this.failures.delete(key);
				this.store(key, this.options.fallback(tile));
				return;
			}
			const delay =
				(this.options.retryDelayMs ?? TILE_RETRY_DELAY_MS) * attempts;
			this.failures.set(key, { attempts, retryAt: this.now() + delay });
		}
	}

	private store(key: string, resource: Resource): void {
		this.cache.set(key, resource);
		this.options.onLoaded?.(key);
	}
}
