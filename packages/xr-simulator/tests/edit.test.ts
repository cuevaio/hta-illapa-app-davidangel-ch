import { describe, expect, it } from 'vitest';
import {
  activeSources, activeWalls, EMPTY_HISTORY, parseCommands, targetAt, push, redo, serializeCommands, undo, wallAt,
  type EditCommand, type WallCommand,
} from '../src/edit/commands';
import { applyEditCpu, packWalls, planEdit } from '../src/edit/walls';

const N = 64;
const DX = 5;
const base = Float32Array.from({ length: N * N }, (_, k) => 100 + 0.1 * (k % N) + 0.03 * Math.floor(k / N));

const wall = (id: string, points: [number, number][], halfWidth = 8, height = 6, material: WallCommand['material'] = 'earth'): WallCommand =>
  ({ type: 'wall', id, points, halfWidth, height, material });

function terrainFor(walls: WallCommand[]): Float32Array {
  const z = Float32Array.from(base);
  applyEditCpu(z, base, N, DX, { mode: 'replay', walls });
  return z;
}

describe('command history', () => {
  it('push / undo / redo / erase', () => {
    const a = wall('a', [[50, 50], [120, 60]]);
    const b = wall('b', [[200, 200], [210, 260]]);
    let h = push(push(EMPTY_HISTORY, a), b);
    expect(activeWalls(h.commands)).toEqual([a, b]);
    h = push(h, { type: 'erase', id: 'e', target: 'a' });
    expect(activeWalls(h.commands)).toEqual([b]);
    h = undo(h);
    expect(activeWalls(h.commands)).toEqual([a, b]);
    h = redo(h);
    expect(activeWalls(h.commands)).toEqual([b]);
    h = undo(undo(h));
    expect(h.redo).toHaveLength(2);
    h = push(h, wall('c', [[10, 10]]));
    expect(h.redo).toHaveLength(0);
  });

  it('keeps every active source, in order; undo and erase remove them', () => {
    const s1: EditCommand = { type: 'source', id: 's1', pos: [10, 10], radius: 20, peakDischarge: 100, volume: 1000 };
    const s2: EditCommand = { type: 'source', id: 's2', pos: [90, 90], radius: 20, peakDischarge: 100, volume: 1000 };
    let h = push(push(EMPTY_HISTORY, s1), s2);
    expect(activeSources(h.commands).map((c) => c.id)).toEqual(['s1', 's2']);
    expect(activeSources(undo(h).commands).map((c) => c.id)).toEqual(['s1']);
    h = push(h, { type: 'erase', id: 'e', target: 's1' });
    expect(activeSources(h.commands).map((c) => c.id)).toEqual(['s2']);
  });

  it('targets the source or wall under a point for erasing (sources first)', () => {
    const cmds: EditCommand[] = [
      wall('w', [[0, 50], [200, 50]], 10),
      { type: 'source', id: 's', pos: [100, 50], radius: 20, peakDischarge: 100, volume: 1000 },
    ];
    expect(targetAt(cmds, 105, 52)?.id).toBe('s');
    expect(targetAt(cmds, 20, 52)?.id).toBe('w');
    expect(targetAt(cmds, 20, 90)).toBeNull();
  });

  it('finds the wall under a point', () => {
    const cmds = [wall('a', [[50, 50], [150, 50]], 10)];
    expect(wallAt(cmds, 100, 55)?.id).toBe('a');
    expect(wallAt(cmds, 100, 75)).toBeNull();
  });

  it('reads walls without a material as earth berms', () => {
    const [w] = parseCommands('[{"type":"wall","id":"a","points":[[0,0],[10,0]],"halfWidth":5,"height":2}]');
    expect((w as WallCommand).material).toBe('earth');
  });

  it('finds a thin concrete wall at its hydraulic width', () => {
    const cmds = [wall('c', [[50, 50], [150, 50]], 0.5, 4, 'concrete')];
    expect(wallAt(cmds, 100, 54, 5)?.id).toBe('c');
    expect(wallAt(cmds, 100, 54)).toBeNull();
  });

  it('serializes to JSON and back', () => {
    const cmds: EditCommand[] = [wall('a', [[1, 2], [3, 4]]), { type: 'erase', id: 'e', target: 'a' }];
    expect(parseCommands(serializeCommands(cmds))).toEqual(cmds);
    expect(() => parseCommands('[{"type":"lava"}]')).toThrow();
  });
});

describe('wall edits on the CPU terrain copy', () => {
  it('raises the crest by the wall height and leaves cells beyond the half width untouched', () => {
    const w = wall('a', [[100, 160], [220, 160]], 10, 6);
    const z = terrainFor([w]);
    const on = 31 * N + 31; // cell centre (157.5, 157.5): 2.5 m from the axis, inside the flat crest
    expect(z[on] - base[on]).toBeCloseTo(6, 4);
    const off = 35 * N + 31; // 17.5 m from the axis
    expect(z[off]).toBe(base[off]);
  });

  it('concrete walls are at least two cells wide and have near-vertical sides', () => {
    // A 1 m thick wall whose axis runs between two rows of cell centres (2.5 m from each):
    // at its real thickness it would touch no cell; at the minimum half width (one cell, 5 m)
    // both rows get the full height and the next rows get nothing.
    const z = terrainFor([wall('c', [[100, 160], [220, 160]], 0.5, 6, 'concrete')]);
    expect(z[31 * N + 31] - base[31 * N + 31]).toBeCloseTo(6, 4);
    expect(z[32 * N + 31] - base[32 * N + 31]).toBeCloseTo(6, 4);
    expect(z[30 * N + 31]).toBe(base[30 * N + 31]);
    expect(z[33 * N + 31]).toBe(base[33 * N + 31]);
  });

  it('earth berms taper over the outer 30% of the half width, concrete over 5%', () => {
    const at = (material: WallCommand['material']) => {
      const z = terrainFor([wall('w', [[100, 157.5], [220, 157.5]], 20, 10, material)]);
      return z[34 * N + 31] - base[34 * N + 31]; // 15 m from the axis = 0.75 hw
    };
    expect(at('earth')).toBeGreaterThan(5);
    expect(at('earth')).toBeLessThan(10);
    expect(at('concrete')).toBeCloseTo(10, 4);
  });

  it('apply then undo restores the terrain bit for bit', () => {
    const a = wall('a', [[40, 40], [90, 120], [150, 130]]);
    const b = wall('b', [[100, 30], [100, 200]], 12, 9);
    const before = terrainFor([a]);
    const z = Float32Array.from(before);
    applyEditCpu(z, base, N, DX, { mode: 'incremental', walls: [b] });
    expect(z).not.toEqual(before);
    // Undo = replay the remaining list on the base terrain.
    applyEditCpu(z, base, N, DX, { mode: 'replay', walls: [a] });
    expect(new Uint32Array(z.buffer)).toEqual(new Uint32Array(before.buffer));
  });

  it('incremental application equals replay of the whole list, bit for bit', () => {
    const walls = [wall('a', [[40, 40], [200, 60]]), wall('b', [[60, 20], [80, 300]], 15, 4), wall('c', [[150, 150]], 20, 3)];
    const inc = Float32Array.from(base);
    for (const w of walls) applyEditCpu(inc, base, N, DX, { mode: 'incremental', walls: [w] });
    expect(new Uint32Array(inc.buffer)).toEqual(new Uint32Array(terrainFor(walls).buffer));
  });

  it('only touches the region of an incremental wall', () => {
    const z = Float32Array.from(base);
    const region = applyEditCpu(z, base, N, DX, { mode: 'incremental', walls: [wall('a', [[100, 100], [120, 100]], 5)] })!;
    expect(region.i1 - region.i0).toBeLessThan(10);
    expect(region.j1 - region.j0).toBeLessThan(5);
  });
});

describe('planEdit and packing', () => {
  const a = wall('a', [[0, 0], [10, 0]]);
  const b = wall('b', [[0, 10], [10, 10], [20, 20]]);
  it('appends incrementally and replays otherwise', () => {
    expect(planEdit([], [a])).toEqual({ mode: 'incremental', walls: [a] });
    expect(planEdit([a], [a, b])).toEqual({ mode: 'incremental', walls: [b] });
    expect(planEdit([a, b], [a])).toEqual({ mode: 'replay', walls: [a] });
    expect(planEdit([a, b], [b])).toEqual({ mode: 'replay', walls: [b] });
    expect(planEdit([a], [a])).toBeNull();
  });
  it('packs polylines into segments', () => {
    const p = packWalls([a, b, wall('c', [[5, 5]], 1, 3, 'concrete')], 5);
    expect(p.segCount).toBe(1 + 2 + 1);
    expect(Array.from(p.cmds.slice(12, 16))).toEqual([1, 2, 8, 6]);
    expect(p.cmds[12 * 2 + 2]).toBe(5); // concrete half width raised to one cell
    expect(p.cmds[12 * 2 + 8]).toBeCloseTo(0.95, 6);
  });
});
