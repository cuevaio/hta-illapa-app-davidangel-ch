import { describe, expect, it } from 'vitest';
import { basiliskSource, ravaflowHydrograph, ravaflowScript } from '../src/scenario/externalScripts';
import { DEFAULT_MATERIAL, triangularHydrograph } from '../src/solver/params';

const c = {
  n: 128, cellSize: 16, material: DEFAULT_MATERIAL,
  emitter: { position: [163.8, 1024.5] as [number, number], radius: 30, hydrograph: triangularHydrograph(60_000, 300) },
  duration: 600, threshold: 0.1,
};

describe('r.avaflow inputs', () => {
  it('samples the hydrograph as T Q1 V1 steps from t = 0 that keep the volume', () => {
    const lines = ravaflowHydrograph(c.emitter.hydrograph, 5).trim().split('\n');
    expect(lines[0]).toBe('T\tQ1\tV1');
    expect(lines[1].split('\t')[0]).toBe('0');
    // Step function: each row holds until the next one.
    const rows = lines.slice(1).map((l) => l.split('\t').map(Number));
    let v = 0;
    for (let k = 0; k + 1 < rows.length; k++) v += rows[k][1] * (rows[k + 1][0] - rows[k][0]);
    expect(v).toBeCloseTo(60_000, -2);
    expect(rows[rows.length - 1][1]).toBe(0);
  });
  it('passes Voellmy friction as delta = atan(mu) in degrees and xi as a negative number', () => {
    const s = ravaflowScript(c);
    expect(s).toContain(',6.84,-400');
    expect(s).toContain('hydrocoords=163.8,1024.5,60,-9999');
    expect(s).toContain('time=10,600');
    expect(s).toContain('thresholds=0.1,');
  });
});

describe('Basilisk source', () => {
  it('bakes the case constants into voellmy.c', () => {
    const s = basiliskSource(c);
    for (const t of ['#define MU 0.12', '#define XI 400', '#define XC 163.8', '#define YC 1024.5', '#define R 30', 'L0 = 2048', 'N = 128', 'event end (t = 600)', '#define HTHR 0.1', 'DT = 0.5;', 'MU*G*dt', 'G*dt*U/(XI*h[])']) {
      expect(s).toContain(t);
    }
  });
});
