import { describe, expect, it } from 'vitest';
import type { EditCommand } from '../src/edit/commands';
import { buildScenario, decodeInlineTerrain, encodeInlineTerrain, parseScenario, serializeScenario } from '../src/scenario/scenario';
import { DEFAULT_MATERIAL } from '../src/solver/params';

const commands: EditCommand[] = [
  { type: 'source', id: 's1', pos: [100, 200], radius: 30, volume: 60_000, peakDischarge: 300 },
  { type: 'source', id: 's2', pos: [400, 500], radius: 20, volume: 10_000, peakDischarge: 100 },
  { type: 'wall', id: 'w1', points: [[10, 10], [50, 60]], halfWidth: 12, height: 8, material: 'earth' },
  { type: 'erase', id: 'e1', target: 's2' },
];

describe('scenario JSON', () => {
  it('round-trips terrain, origins, edit commands and material', () => {
    const s = buildScenario({ name: 'prueba', terrain: { kind: 'synthetic', size_m: 2048 }, material: DEFAULT_MATERIAL, commands, speed: 10 });
    const back = parseScenario(serializeScenario(s));
    expect(back).toEqual(s);
    expect(back.format).toBe('huaico-scenario');
    expect(back.version).toBe(1);
  });

  it('lists the active origins with their explicit hydrograph', () => {
    const s = buildScenario({ name: 'x', terrain: { kind: 'synthetic', size_m: 2048 }, material: DEFAULT_MATERIAL, commands, speed: 10 });
    // s2 is erased, so only s1 is an active origin.
    expect(s.origins.map((o) => o.id)).toEqual(['s1']);
    expect(s.origins[0].hydrograph).toEqual([{ t: 0, q: 0 }, { t: 400 / 3, q: 300 }, { t: 400, q: 0 }]);
  });

  it('accepts a reference to an external DEM', () => {
    const json = serializeScenario(buildScenario({
      name: 'dem', terrain: { kind: 'dem-ref', uri: 'dem/quebrada.tif', format: 'geotiff' }, material: DEFAULT_MATERIAL, commands: [], speed: 1,
    }));
    expect(parseScenario(json).terrain).toEqual({ kind: 'dem-ref', uri: 'dem/quebrada.tif', format: 'geotiff' });
  });

  it('embeds a DEM inline as base64 float32 and decodes it exactly', () => {
    const heights = Float32Array.from({ length: 16 }, (_, k) => 100 + k * 0.25);
    const t = encodeInlineTerrain({ resolution: 4, cellSize: 7.5, heights }, 'mi-dem.tif');
    expect(t).toMatchObject({ kind: 'dem-inline', resolution: 4, cellSize: 7.5, encoding: 'float32-base64', label: 'mi-dem.tif' });
    const parsed = parseScenario(serializeScenario(buildScenario({ name: 'i', terrain: t, material: DEFAULT_MATERIAL, commands: [], speed: 1 })));
    const g = decodeInlineTerrain(parsed.terrain as Extract<typeof parsed.terrain, { kind: 'dem-inline' }>);
    expect(g.resolution).toBe(4);
    expect(Array.from(g.heights)).toEqual(Array.from(heights));
  });

  it('rejects other formats, newer versions and malformed parts with a clear message', () => {
    const ok = JSON.parse(serializeScenario(buildScenario({ name: 'x', terrain: { kind: 'synthetic', size_m: 2048 }, material: DEFAULT_MATERIAL, commands, speed: 10 })));
    const bad = (patch: object) => () => parseScenario(JSON.stringify({ ...ok, ...patch }));
    expect(() => parseScenario('no es json')).toThrow(/JSON/);
    expect(bad({ format: 'otro' })).toThrow(/no es un escenario/);
    expect(bad({ version: 2 })).toThrow(/versión 2/);
    expect(bad({ terrain: { kind: 'lidar' } })).toThrow(/terreno/);
    expect(bad({ material: { ...ok.material, mu: 'alto' } })).toThrow(/material\.mu/);
    expect(bad({ commands: [{ type: 'teleport', id: 'x' }] })).toThrow(/commands\[0\]/);
    expect(bad({ commands: [{ type: 'source', id: 's', pos: [1], radius: 1, volume: 1, peakDischarge: 1 }] })).toThrow(/commands\[0\]\.pos/);
    expect(bad({ commands: [{ type: 'source', id: 's', pos: [1, 2], radius: -5, volume: 1, peakDischarge: 1 }] })).toThrow(/commands\[0\]\.radius/);
    expect(bad({ material: { ...ok.material, density: 0 } })).toThrow(/material\.density/);
    expect(bad({ terrain: { kind: 'dem-inline', resolution: 0, cellSize: 5, encoding: 'float32-base64', data: '' } })).toThrow(/terrain\.resolution/);
    expect(bad({ terrain: { kind: 'dem-inline', resolution: 4, cellSize: -1, encoding: 'float32-base64', data: '' } })).toThrow(/terrain\.cellSize/);
  });
});
