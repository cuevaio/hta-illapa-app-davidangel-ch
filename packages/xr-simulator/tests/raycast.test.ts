import { describe, expect, it } from 'vitest';
import type { Ray } from '../src/input/pointer';
import { raycastHeightField } from '../src/input/raycast';
import { Terrain } from '../src/scenario/terrain';

const N = 64;
const DX = 5;

function terrain(fn: (x: number, z: number) => number): Terrain {
  const heights = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) heights[j * N + i] = fn((i + 0.5) * DX, (j + 0.5) * DX);
  return new Terrain({ resolution: N, cellSize: DX, heights });
}

function ray(origin: [number, number, number], target: [number, number, number]): Ray {
  const d = target.map((v, k) => v - origin[k]);
  const len = Math.hypot(...d);
  return { origin, direction: d.map((v) => v / len) as [number, number, number] };
}

describe('raycastHeightField', () => {
  it('hits an inclined plane at the analytic point', () => {
    const plane = terrain((x) => 0.2 * x + 10);
    const target: [number, number, number] = [120, 0.2 * 120 + 10, 150];
    const hit = raycastHeightField(plane, ray([20, 300, 40], target))!;
    expect(hit).not.toBeNull();
    hit.point.forEach((v, k) => expect(v).toBeCloseTo(target[k], 2));
  });

  it('hits the correct side of a ramp seen at a grazing angle', () => {
    // Flat at 0 until x = 150, then rises with slope 0.5.
    const ramp = terrain((x) => Math.max(0, 0.5 * (x - 150)));
    const hit = raycastHeightField(ramp, ray([10, 20, 100], [300, 20, 100]))!;
    // The horizontal ray at y = 20 meets the ramp where 0.5 (x - 150) = 20.
    expect(hit.point[0]).toBeCloseTo(190, 1);
    expect(hit.point[1]).toBeCloseTo(20, 3);
  });

  it('returns null when the ray points away from the terrain', () => {
    const flat = terrain(() => 0);
    expect(raycastHeightField(flat, ray([100, 50, 100], [100, 500, 120]))).toBeNull();
    expect(raycastHeightField(flat, ray([-100, 50, -100], [-500, 0, -300]))).toBeNull();
  });

  it('hits straight down from above', () => {
    const plane = terrain((x, z) => 0.1 * x - 0.05 * z);
    const hit = raycastHeightField(plane, { origin: [100, 500, 200], direction: [0, -1, 0] })!;
    expect(hit.point[1]).toBeCloseTo(0.1 * 100 - 0.05 * 200, 3);
  });
});
