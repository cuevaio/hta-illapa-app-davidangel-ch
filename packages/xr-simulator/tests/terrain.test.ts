import { describe, expect, it } from 'vitest';
import { rasterToHeightGrid } from '../src/scenario/dem';
import { channelCenter, createSyntheticRavine, resampleGrid, syntheticElevation, syntheticEmitterPosition, SYNTHETIC_SIZE, Terrain } from '../src/scenario/terrain';
import { DEFAULT_MATERIAL } from '../src/solver/params';

describe('synthetic ravine', () => {
  it('has a thalweg that descends from the head to the fan', () => {
    let prev = Infinity;
    for (let s = 0.02; s <= 0.9; s += 0.02) {
      const z = syntheticElevation(s, channelCenter(s));
      expect(z).toBeLessThan(prev + 6); // noise tolerance
      prev = z;
    }
    expect(syntheticElevation(0.05, channelCenter(0.05)) - syntheticElevation(0.55, channelCenter(0.55))).toBeGreaterThan(200);
  });

  it('has a fan flatter than atan(mu) so the default material deposits there', () => {
    const dz = syntheticElevation(0.7, 0.5) - syntheticElevation(0.85, 0.5);
    const gradient = dz / (0.15 * SYNTHETIC_SIZE);
    expect(gradient).toBeGreaterThan(0.02);
    expect(gradient).toBeLessThan(DEFAULT_MATERIAL.mu);
  });

  it('puts the default emitter inside the channel', () => {
    const t = new Terrain(createSyntheticRavine(256));
    const [x, z] = syntheticEmitterPosition();
    const here = t.heightAt(x, z);
    expect(t.heightAt(x, z + 60)).toBeGreaterThan(here + 5);
    expect(t.heightAt(x, z - 60)).toBeGreaterThan(here + 5);
  });
});

describe('DEM import', () => {
  it('crops the centred square, fills no-data and resamples', () => {
    const width = 6;
    const height = 4;
    const data = Array.from({ length: width * height }, (_, k) => (k === 7 ? -9999 : 100 + k));
    const grid = rasterToHeightGrid({ width, height, cellSize: 10, data, noData: -9999 }, 4);
    expect(grid.resolution).toBe(4);
    expect(grid.cellSize).toBe(10);
    // Column offset 1: first row is samples 1..4; sample 7 (row 1, col 1) is no-data -> lowest valid (100).
    expect(Array.from(grid.heights.slice(0, 4))).toEqual([101, 102, 103, 104]);
    expect(grid.heights[4]).toBe(100);
  });

  it('resampling keeps the extent', () => {
    const g = resampleGrid(createSyntheticRavine(64), 128);
    expect(g.resolution * g.cellSize).toBeCloseTo(SYNTHETIC_SIZE, 6);
  });
});
