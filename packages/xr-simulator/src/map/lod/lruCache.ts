export interface LruCacheOptions<K, V> {
  capacity: number;
  /** Called whenever an entry leaves the cache (eviction, overwrite, delete, clear). */
  onEvict: (key: K, value: V) => void;
  /** Pinned entries (the LOD working set) are never evicted; the cache may exceed capacity. */
  isPinned?: (key: K) => boolean;
}

/** Least-recently-used cache on Map insertion order (after peru-simulator). */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly options: LruCacheOptions<K, V>) {}

  get size(): number {
    return this.map.size;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Value, marked most recently used. */
  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  peek(key: K): V | undefined {
    return this.map.get(key);
  }

  keys(): IterableIterator<K> {
    return this.map.keys();
  }

  set(key: K, value: V): void {
    const prev = this.map.get(key);
    if (prev !== undefined) {
      this.map.delete(key);
      if (prev !== value) this.options.onEvict(key, prev);
    }
    this.map.set(key, value);
    this.evictOverflow();
  }

  delete(key: K): void {
    const v = this.map.get(key);
    if (v === undefined) return;
    this.map.delete(key);
    this.options.onEvict(key, v);
  }

  clear(): void {
    const entries = [...this.map];
    this.map.clear();
    for (const [k, v] of entries) this.options.onEvict(k, v);
  }

  private evictOverflow(): void {
    if (this.map.size <= this.options.capacity) return;
    const pinned = this.options.isPinned ?? (() => false);
    for (const key of [...this.map.keys()]) {
      if (this.map.size <= this.options.capacity) break;
      if (!pinned(key)) this.delete(key);
    }
  }
}
