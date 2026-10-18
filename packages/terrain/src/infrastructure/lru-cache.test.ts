import { describe, expect, it, vi } from "vitest";
import { LruCache } from "./lru-cache";

describe("LruCache", () => {
	it("evicts the least recently used entry and passes it to onEvict", () => {
		const onEvict = vi.fn();
		const cache = new LruCache<string, number>({ capacity: 2, onEvict });
		cache.set("a", 1);
		cache.set("b", 2);
		cache.get("a");
		cache.set("c", 3);
		expect(onEvict).toHaveBeenCalledTimes(1);
		expect(onEvict).toHaveBeenCalledWith("b", 2);
		expect(cache.has("a")).toBe(true);
		expect(cache.has("b")).toBe(false);
		expect(cache.size).toBe(2);
	});

	it("calls dispose on evicted GPU-like resources", () => {
		const dispose = vi.fn();
		const cache = new LruCache<string, { dispose: () => void }>({
			capacity: 1,
			onEvict: (_key, value) => value.dispose(),
		});
		cache.set("a", { dispose });
		cache.set("b", { dispose: () => {} });
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it("does not evict pinned entries even when over capacity", () => {
		const onEvict = vi.fn();
		const pinned = new Set(["a", "b"]);
		const cache = new LruCache<string, number>({
			capacity: 2,
			onEvict,
			isPinned: (key) => pinned.has(key),
		});
		cache.set("a", 1);
		cache.set("b", 2);
		cache.set("c", 3);
		expect(onEvict).toHaveBeenCalledWith("c", 3);
		expect(cache.has("a") && cache.has("b")).toBe(true);
		pinned.clear();
		cache.set("d", 4);
		expect(cache.size).toBe(2);
	});

	it("disposes the previous value when a key is overwritten", () => {
		const onEvict = vi.fn();
		const cache = new LruCache<string, number>({ capacity: 3, onEvict });
		cache.set("a", 1);
		cache.set("a", 2);
		expect(onEvict).toHaveBeenCalledWith("a", 1);
		expect(cache.get("a")).toBe(2);
	});

	it("disposes every entry on clear", () => {
		const onEvict = vi.fn();
		const cache = new LruCache<string, number>({ capacity: 3, onEvict });
		cache.set("a", 1);
		cache.set("b", 2);
		cache.clear();
		expect(onEvict).toHaveBeenCalledTimes(2);
		expect(cache.size).toBe(0);
	});
});
