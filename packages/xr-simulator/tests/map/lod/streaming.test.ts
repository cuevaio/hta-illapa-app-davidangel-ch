import { describe, expect, it, vi } from 'vitest';
import { FrameBudget } from '../../../src/map/lod/frameBudget';
import { LruCache } from '../../../src/map/lod/lruCache';
import { RequestScheduler } from '../../../src/map/lod/requestScheduler';
import { TileLayer } from '../../../src/map/lod/tileLayer';
import type { TileRequest } from '../../../src/map/lod/lod';
import { tileKey } from '../../../src/map/lod/quadtree';
import { rootsReadiness } from '../../../src/map/lod/tileLayer';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('LruCache', () => {
  it('evicts the least recently used entry and disposes it', () => {
    const evicted: string[] = [];
    const c = new LruCache<string, number>({ capacity: 2, onEvict: (k) => evicted.push(k) });
    c.set('a', 1);
    c.set('b', 2);
    c.get('a');
    c.set('c', 3);
    expect(evicted).toEqual(['b']);
    expect(c.has('a') && c.has('c')).toBe(true);
  });
  it('never evicts pinned entries (the LOD working set), even over capacity', () => {
    const evicted: string[] = [];
    const pinned = new Set(['a', 'b']);
    const c = new LruCache<string, number>({ capacity: 2, onEvict: (k) => evicted.push(k), isPinned: (k) => pinned.has(k) });
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    expect(evicted).toEqual(['c']);
    expect(c.size).toBe(2);
  });
  it('disposes on overwrite, delete and clear', () => {
    const evicted: number[] = [];
    const c = new LruCache<string, number>({ capacity: 5, onEvict: (_k, v) => evicted.push(v) });
    c.set('a', 1);
    c.set('a', 2);
    c.set('b', 3);
    c.delete('b');
    c.clear();
    expect(evicted).toEqual([1, 3, 2]);
  });
});

describe('RequestScheduler', () => {
  it('runs at most maxConcurrent tasks, lowest priority value first', async () => {
    const s = new RequestScheduler({ maxConcurrent: 2 });
    const started: string[] = [];
    const gates: Record<string, () => void> = {};
    const task = (k: string) => () => new Promise<void>((res) => {
      started.push(k);
      gates[k] = res;
    });
    s.schedule('c', 3, task('c'));
    s.schedule('a', 1, task('a'));
    expect(s.stats.inFlight).toBe(2);
    s.schedule('b', 0, task('b'));
    expect(started).toEqual(['c', 'a']);
    gates.a();
    await flush();
    expect(started).toEqual(['c', 'a', 'b']);
    expect(s.stats.inFlight).toBe(2);
  });
  it('aborts running tasks and drops queued ones that are no longer wanted', () => {
    const s = new RequestScheduler({ maxConcurrent: 1 });
    let signal: AbortSignal | null = null;
    s.schedule('a', 0, (sig) => {
      signal = sig;
      return new Promise(() => {});
    });
    s.schedule('b', 1, () => new Promise(() => {}));
    s.retainOnly(new Set());
    expect(signal!.aborted).toBe(true);
    expect(s.stats).toEqual({ queued: 0, inFlight: 0 });
  });
});

describe('FrameBudget (uploads per frame)', () => {
  it('releases at most N acquisitions per tick, in order', async () => {
    const b = new FrameBudget(2);
    const got: number[] = [];
    for (let i = 0; i < 5; i++) void b.acquire().then(() => got.push(i));
    await flush();
    expect(got).toEqual([]);
    b.tick();
    await flush();
    expect(got).toEqual([0, 1]);
    b.tick();
    await flush();
    expect(got).toEqual([0, 1, 2, 3]);
  });
  it('an aborted waiter rejects and gives its turn away', async () => {
    const b = new FrameBudget(1);
    const ctrl = new AbortController();
    const first = b.acquire(ctrl.signal);
    let second = false;
    void b.acquire().then(() => (second = true));
    ctrl.abort();
    await expect(first).rejects.toThrow();
    b.tick();
    await flush();
    expect(second).toBe(true);
  });
});

const req = (z: number, x: number, y: number, priority: number, prefetch = false): TileRequest => ({ tile: { z, x, y }, key: tileKey({ z, x, y }), priority, prefetch });

describe('TileLayer', () => {
  function layer(capacity: number, maxConcurrent = 8) {
    const disposed: string[] = [];
    const loads: string[] = [];
    const l = new TileLayer<{ key: string; dispose(): void }>({
      capacity,
      maxConcurrent,
      load: async (t) => {
        const key = tileKey(t);
        loads.push(key);
        return { key, dispose: () => disposed.push(key) };
      },
    });
    return { l, disposed, loads };
  }

  it('loads needed tiles and never evicts the working set', async () => {
    const { l, disposed } = layer(2);
    l.update([req(5, 0, 0, 1), req(5, 1, 0, 2)], new Set(['5/0/0', '5/1/0']));
    await flush();
    expect(l.isReady('5/0/0') && l.isReady('5/1/0')).toBe(true);
    // A third needed tile does not fit beside the retained two: it is not downloaded.
    l.update([req(5, 2, 0, 3)], new Set(['5/0/0', '5/1/0', '5/2/0']));
    await flush();
    expect(l.isReady('5/2/0')).toBe(false);
    expect(disposed).toEqual([]);
    // Once the old tiles leave the working set they can be evicted (and disposed).
    l.update([req(5, 2, 0, 3)], new Set(['5/2/0']));
    await flush();
    expect(l.isReady('5/2/0')).toBe(true);
    expect(disposed.length).toBe(1);
  });

  it('prefetch only uses spare capacity and keeps prefetched tiles cached', async () => {
    const { l, loads } = layer(3);
    l.update([req(5, 0, 0, 1), req(6, 0, 0, 1e12, true), req(6, 1, 0, 1e12 + 1, true), req(6, 2, 0, 1e12 + 2, true)], new Set(['5/0/0']));
    await flush();
    expect(loads).toEqual(['5/0/0', '6/0/0', '6/1/0']);
  });

  it('disposes a resource that arrives after its request was cancelled', async () => {
    const disposed: string[] = [];
    let resolve: (() => void) | null = null;
    const l = new TileLayer<{ dispose(): void }>({
      capacity: 4,
      maxConcurrent: 4,
      load: () => new Promise((res) => (resolve = () => res({ dispose: () => disposed.push('x') }))),
    });
    l.update([req(5, 0, 0, 1)], new Set(['5/0/0']));
    l.update([], new Set());
    resolve!();
    await flush();
    expect(disposed).toEqual(['x']);
    expect(l.isReady('5/0/0')).toBe(false);
  });

  it('marks a tile broken after maxAttempts failures so refinement can stop', async () => {
    let now = 0;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const l = new TileLayer<{ dispose(): void }>({
      capacity: 4, maxConcurrent: 4, maxAttempts: 2, retryDelayMs: 10, now: () => now,
      load: () => Promise.reject(new Error('HTTP 500')),
    });
    l.update([req(6, 0, 0, 1)], new Set(['6/0/0']));
    await flush();
    expect(l.isBroken('6/0/0')).toBe(false);
    now = 100;
    l.update([req(6, 0, 0, 1)], new Set(['6/0/0']));
    await flush();
    expect(l.isBroken('6/0/0')).toBe(true);
    warn.mockRestore();
  });
});

describe('TileLayer retries (B1: idle camera)', () => {
  it('reports a due retry once its retryAt passes, so an idle LOD reselects and re-requests the tile', async () => {
    let now = 0;
    let fail = true;
    const loads: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const l = new TileLayer<{ dispose(): void }>({
      capacity: 4, maxConcurrent: 4, maxAttempts: 3, retryDelayMs: 10, now: () => now,
      load: (t) => {
        loads.push(tileKey(t));
        return fail ? Promise.reject(new Error('HTTP 503')) : Promise.resolve({ dispose() {} });
      },
    });
    l.update([req(5, 0, 0, 1)], new Set(['5/0/0']));
    await flush();
    expect(l.takeDueRetry()).toBe(false);
    now = 9;
    expect(l.takeDueRetry()).toBe(false);
    now = 10;
    expect(l.takeDueRetry()).toBe(true);
    // Reported once: the reselect re-requests it.
    expect(l.takeDueRetry()).toBe(false);
    fail = false;
    l.update([req(5, 0, 0, 1)], new Set(['5/0/0']));
    await flush();
    expect(loads).toEqual(['5/0/0', '5/0/0']);
    expect(l.isReady('5/0/0')).toBe(true);
    expect(l.takeDueRetry()).toBe(false);
    warn.mockRestore();
  });
});

describe('rootsReadiness (overview ready)', () => {
  const keys = ['5/0/0', '5/1/0'];
  it('is pending while a root is neither loaded nor broken', () => {
    expect(rootsReadiness(keys, (k) => k === '5/0/0', () => false)).toBe('pending');
  });
  it('is ready when every root loaded', () => {
    expect(rootsReadiness(keys, () => true, () => false)).toBe('ready');
  });
  it('fails as soon as one root is permanently broken (fallback notice + simulator)', () => {
    expect(rootsReadiness(keys, (k) => k === '5/0/0', (k) => k === '5/1/0')).toBe('failed');
    expect(rootsReadiness(keys, () => false, (k) => k === '5/1/0')).toBe('failed');
  });
});
