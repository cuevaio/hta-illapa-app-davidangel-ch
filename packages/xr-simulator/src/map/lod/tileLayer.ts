import type { TileId } from "../tileMath";
import type { TileRequest } from "./lod";
import { LruCache } from "./lruCache";
import { RequestScheduler } from "./requestScheduler";

export interface Disposable {
	dispose(): void;
}

export interface TileLayerOptions<R extends Disposable> {
	load: (tile: TileId, signal: AbortSignal) => Promise<R>;
	capacity: number;
	maxConcurrent: number;
	/** After this many failures the tile is "broken": its parent stops refining. */
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

/** One streamed tile dataset: scheduler + bounded LRU of disposable resources (after peru-simulator). */
export class TileLayer<R extends Disposable> {
	private readonly scheduler: RequestScheduler;
	private readonly cache: LruCache<string, R>;
	private readonly failures = new Map<
		string,
		{ attempts: number; retryAt: number; reported: boolean }
	>();
	private readonly broken = new Set<string>();
	private pinned: ReadonlySet<string> = new Set();
	private generation = 0;
	private readonly now: () => number;

	constructor(private readonly options: TileLayerOptions<R>) {
		this.scheduler = new RequestScheduler({
			maxConcurrent: options.maxConcurrent,
		});
		this.cache = new LruCache<string, R>({
			capacity: options.capacity,
			onEvict: (_k, v) => v.dispose(),
			isPinned: (k) => this.pinned.has(k),
		});
		this.now = options.now ?? (() => performance.now());
	}

	get stats(): TileLayerStats {
		return { cached: this.cache.size, ...this.scheduler.stats };
	}

	isReady(key: string): boolean {
		return this.cache.has(key);
	}

	isBroken(key: string): boolean {
		return this.broken.has(key);
	}

	get(key: string): R | undefined {
		return this.cache.peek(key);
	}

	/**
	 * Keeps the working set `retain` (never evicted) and streams what is missing. Needed
	 * requests only use the capacity left beside the retained tiles, so an oversized working
	 * set stops downloading instead of thrashing; prefetch uses spare request slots and the
	 * remaining headroom. Requests no longer wanted are aborted.
	 */
	update(requests: readonly TileRequest[], retain: ReadonlySet<string>): void {
		const pinned = new Set<string>();
		for (const key of retain)
			if (this.cache.get(key) !== undefined) pinned.add(key);
		const blocked = (key: string) => {
			if (this.broken.has(key)) return true;
			const f = this.failures.get(key);
			return f !== undefined && f.retryAt > this.now();
		};
		const missing = requests
			.filter((r) => !r.prefetch && !this.cache.has(r.key) && !blocked(r.key))
			.sort((a, b) => a.priority - b.priority);
		const needed = missing.slice(
			0,
			Math.max(0, this.options.capacity - pinned.size),
		);
		const reserved = new Set([...retain, ...needed.map((r) => r.key)]).size;
		const prefetchBudget =
			missing.length >= this.options.maxConcurrent
				? 0
				: Math.max(0, this.options.capacity - reserved);
		const prefetch: TileRequest[] = [];
		const candidates = requests
			.filter((r) => r.prefetch && !pinned.has(r.key))
			.sort((a, b) => a.priority - b.priority);
		for (const r of candidates.slice(0, prefetchBudget)) {
			if (this.cache.get(r.key) !== undefined) pinned.add(r.key);
			else if (!blocked(r.key)) prefetch.push(r);
		}
		this.pinned = pinned;
		const wanted = new Set<string>();
		for (const r of [...needed, ...prefetch]) {
			wanted.add(r.key);
			this.scheduler.schedule(r.key, r.priority, (signal) =>
				this.fetch(r.tile, r.key, signal),
			);
		}
		this.scheduler.retainOnly(wanted);
	}

	/**
	 * True once when a failed tile's retry time has passed: the owner must call update()
	 * again (reselect) even if its view did not change, or an idle camera never retries.
	 */
	takeDueRetry(): boolean {
		const now = this.now();
		let due = false;
		for (const f of this.failures.values()) {
			if (!f.reported && f.retryAt <= now) {
				f.reported = true;
				due = true;
			}
		}
		return due;
	}

	/** Cancels every request and disposes every cached resource. */
	clear(): void {
		this.generation++;
		this.scheduler.cancelAll();
		this.failures.clear();
		this.broken.clear();
		this.pinned = new Set();
		this.cache.clear();
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
			this.cache.set(key, resource);
			this.options.onLoaded?.(key);
		} catch (err) {
			if (signal.aborted || generation !== this.generation) return;
			const attempts = (this.failures.get(key)?.attempts ?? 0) + 1;
			if (attempts >= (this.options.maxAttempts ?? 3)) {
				this.failures.delete(key);
				this.broken.add(key);
				this.options.onLoaded?.(key);
			} else {
				this.failures.set(key, {
					attempts,
					retryAt: this.now() + (this.options.retryDelayMs ?? 3000) * attempts,
					reported: false,
				});
			}
			console.warn(`Tile ${key} falló (intento ${attempts})`, err);
		}
	}
}

/**
 * Readiness of a set of tiles that must all be drawn (the overview roots): ready when every
 * one loaded, failed as soon as one is permanently broken (after its final attempt), else
 * pending.
 */
export function rootsReadiness(
	keys: readonly string[],
	isReady: (k: string) => boolean,
	isBroken: (k: string) => boolean,
): "pending" | "ready" | "failed" {
	if (keys.some(isBroken)) return "failed";
	return keys.every(isReady) ? "ready" : "pending";
}
