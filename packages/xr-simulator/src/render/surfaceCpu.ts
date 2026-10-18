/**
 * CPU mirror of SURFACE_WGSL, used by the plan-B path (CPU solver + WebGL2).
 * Writes xyz positions, normals and rgba colours for the flow mesh.
 */
export interface SurfaceInputs {
  n: number;
  dx: number;
  h: ArrayLike<number>;
  hu: ArrayLike<number>;
  hv: ArrayLike<number>;
  z: ArrayLike<number>;
  colorMode: 'depth' | 'speed';
  depthScale: number;
  speedScale: number;
}

export const H_VISIBLE = 0.01;
export const DRY_OFFSET = 1.0;

const DEPTH_RAMP: [number, number, number][] = [[0.78, 0.66, 0.48], [0.55, 0.38, 0.22], [0.25, 0.14, 0.07]];
const SPEED_RAMP: [number, number, number][] = [[0.15, 0.35, 0.85], [0.95, 0.85, 0.2], [0.85, 0.12, 0.08]];

function ramp(t: number, stops: [number, number, number][], out: Float32Array, o: number): void {
  const [a, b] = t < 0.5 ? [stops[0], stops[1]] : [stops[1], stops[2]];
  const f = t < 0.5 ? t * 2 : t * 2 - 1;
  out[o] = a[0] + f * (b[0] - a[0]);
  out[o + 1] = a[1] + f * (b[1] - a[1]);
  out[o + 2] = a[2] + f * (b[2] - a[2]);
}

export function writeSurfaceCpu(s: SurfaceInputs, positions: Float32Array, normals: Float32Array, colors: Float32Array): void {
  const { n, dx, h, hu, hv, z } = s;
  const surf = (i: number, j: number) => {
    const k = j * n + i;
    return h[k] > H_VISIBLE ? z[k] + h[k] : z[k];
  };
  const stops = s.colorMode === 'depth' ? DEPTH_RAMP : SPEED_RAMP;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const wet = h[k] > H_VISIBLE;
      positions[3 * k] = (i + 0.5) * dx;
      positions[3 * k + 1] = wet ? z[k] + h[k] : z[k] - DRY_OFFSET;
      positions[3 * k + 2] = (j + 0.5) * dx;
      const hx = surf(Math.min(i + 1, n - 1), j) - surf(Math.max(i - 1, 0), j);
      const hz = surf(i, Math.min(j + 1, n - 1)) - surf(i, Math.max(j - 1, 0));
      const len = Math.hypot(hx, 2 * dx, hz);
      normals[3 * k] = -hx / len;
      normals[3 * k + 1] = (2 * dx) / len;
      normals[3 * k + 2] = -hz / len;
      const t = s.colorMode === 'depth' ? h[k] / s.depthScale : Math.hypot(hu[k], hv[k]) / Math.max(h[k], 1e-4) / s.speedScale;
      ramp(Math.min(Math.max(t, 0), 1), stops, colors, 4 * k);
      colors[4 * k + 3] = wet ? 0.92 : 0;
    }
  }
}
