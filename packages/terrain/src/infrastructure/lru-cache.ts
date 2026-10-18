export interface LruCacheOptions<Key, Value> {
	capacity: number;
	/** Called whenever an entry leaves the cache (eviction, overwrite, delete, clear). */
	onEvict: (key: Key, value: Value) => void;
	/** Pinned entries are never evicted; the cache may temporarily exceed capacity. */
	isPinned?: (key: Key) => boolean;
}

/** Least-recently-used cache backed by Map insertion order. */
export class LruCache<Key, Value> {
	private readonly map = new Map<Key, Value>();

	constructor(private readonly options: LruCacheOptions<Key, Value>) {}

	get size(): number {
		return this.map.size;
	}

	has(key: Key): boolean {
		return this.map.has(key);
	}

	/** Returns the value and marks it as most recently used. */
	get(key: Key): Value | undefined {
		const value = this.map.get(key);
		if (value !== undefined) {
			this.map.delete(key);
			this.map.set(key, value);
		}
		return value;
	}

	peek(key: Key): Value | undefined {
		return this.map.get(key);
	}

	set(key: Key, value: Value): void {
		const previous = this.map.get(key);
		if (previous !== undefined) {
			this.map.delete(key);
			if (previous !== value) this.options.onEvict(key, previous);
		}
		this.map.set(key, value);
		this.evictOverflow();
	}

	delete(key: Key): void {
		const value = this.map.get(key);
		if (value === undefined) return;
		this.map.delete(key);
		this.options.onEvict(key, value);
	}

	clear(): void {
		const entries = [...this.map];
		this.map.clear();
		for (const [key, value] of entries) this.options.onEvict(key, value);
	}

	private evictOverflow(): void {
		if (this.map.size <= this.options.capacity) return;
		const isPinned = this.options.isPinned ?? (() => false);
		for (const key of [...this.map.keys()]) {
			if (this.map.size <= this.options.capacity) break;
			if (!isPinned(key)) this.delete(key);
		}
	}
}
