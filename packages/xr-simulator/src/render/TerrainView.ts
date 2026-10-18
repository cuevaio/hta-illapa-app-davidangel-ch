import { Color3, Mesh, RawTexture, StandardMaterial, Texture, VertexBuffer, VertexData, type Scene, type TransformNode } from '@babylonjs/core';
import type { CellRegion } from '../edit/walls';
import type { Terrain } from '../scenario/terrain';

/** Grid mesh indices shared by the terrain and flow meshes (vertex = cell centre). */
export function gridIndices(n: number): Uint32Array {
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let p = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
  }
  return idx;
}

const HYPSO: [number, [number, number, number]][] = [
  [0.0, [0.42, 0.47, 0.3]],
  [0.25, [0.6, 0.58, 0.38]],
  [0.55, [0.66, 0.55, 0.42]],
  [0.8, [0.58, 0.54, 0.5]],
  [1.0, [0.86, 0.85, 0.83]],
];

function hypsometric(t: number): [number, number, number] {
  for (let k = 1; k < HYPSO.length; k++) {
    if (t <= HYPSO[k][0]) {
      const [t0, c0] = HYPSO[k - 1];
      const [t1, c1] = HYPSO[k];
      const f = (t - t0) / (t1 - t0);
      return [c0[0] + f * (c1[0] - c0[0]), c0[1] + f * (c1[1] - c0[1]), c0[2] + f * (c1[2] - c0[2])];
    }
  }
  return HYPSO[HYPSO.length - 1][1];
}

/** Compacted earth / riprap colour for berms built over the terrain. */
const EARTHWORK: [number, number, number] = [0.5, 0.42, 0.33];

/** Picks a contour interval giving roughly 20-40 lines over the relief. */
export function contourInterval(relief: number): number {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200];
  return steps.find((s) => relief / s <= 40) ?? 500;
}

/**
 * Terrain mesh built from the CPU copy of the effective terrain, with a baked
 * hypsometric texture and optional contour lines. Lighting comes from normals.
 */
export class TerrainView {
  readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private texture: RawTexture | null = null;
  private readonly scene: Scene;
  private terrain: Terrain;
  private contours: boolean;
  /** Colour scale and contour interval, fixed at build time so edits do not recolour the map. */
  private range: [number, number] = [0, 1];
  private interval = 10;
  private texSize = 512;
  private texHeights = new Float32Array(0);
  /** Edit-induced elevation per texture pixel: earthworks are tinted as compacted earth. */
  private texRaise = new Float32Array(0);
  private rgba = new Uint8Array(0);

  constructor(scene: Scene, root: TransformNode, terrain: Terrain, contours: boolean) {
    this.scene = scene;
    this.terrain = terrain;
    this.contours = contours;
    this.mesh = new Mesh('terrain', scene);
    this.mesh.parent = root;
    this.mesh.isPickable = false;
    this.material = new StandardMaterial('terrain-mat', scene);
    this.material.specularColor = new Color3(0.04, 0.04, 0.04);
    this.material.backFaceCulling = false;
    this.mesh.material = this.material;
    this.rebuild(terrain);
  }

  rebuild(terrain: Terrain): void {
    this.terrain = terrain;
    const n = terrain.resolution;
    const dx = terrain.cellSize;
    const positions = new Float32Array(n * n * 3);
    const uvs = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        positions[3 * k] = (i + 0.5) * dx;
        positions[3 * k + 1] = terrain.effective[k];
        positions[3 * k + 2] = (j + 0.5) * dx;
        uvs[2 * k] = (i + 0.5) / n;
        uvs[2 * k + 1] = (j + 0.5) / n;
      }
    }
    const data = new VertexData();
    data.positions = positions;
    data.normals = this.normals();
    data.uvs = uvs;
    data.indices = gridIndices(n);
    data.applyToMesh(this.mesh, true);
    this.range = terrain.minMax();
    this.interval = contourInterval(Math.max(this.range[1] - this.range[0], 1e-3));
    this.texSize = Math.min(Math.max(4 * n, 512), 1024);
    this.texHeights = new Float32Array(this.texSize * this.texSize);
    this.texRaise = new Float32Array(this.texSize * this.texSize);
    this.rgba = new Uint8Array(this.texSize * this.texSize * 4);
    this.sampleHeights(0, 0, this.texSize - 1, this.texSize - 1);
    this.bakeTexture();
  }

  /** Updates geometry and texture of the cells an edit touched (plus a one-cell margin). */
  refreshRegion(r: CellRegion): void {
    const n = this.terrain.resolution;
    const positions = this.mesh.getVerticesData(VertexBuffer.PositionKind) as Float32Array;
    const normals = this.mesh.getVerticesData(VertexBuffer.NormalKind) as Float32Array;
    const i0 = Math.max(0, r.i0 - 1);
    const j0 = Math.max(0, r.j0 - 1);
    const i1 = Math.min(n - 1, r.i1 + 1);
    const j1 = Math.min(n - 1, r.j1 + 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * n + i;
        positions[3 * k + 1] = this.terrain.effective[k];
        this.normalAt(i, j, normals, 3 * k);
      }
    }
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
    this.mesh.updateVerticesData(VertexBuffer.NormalKind, normals);
    const scale = this.texSize / n;
    this.sampleHeights(Math.floor(i0 * scale), Math.floor(j0 * scale), Math.ceil((i1 + 1) * scale), Math.ceil((j1 + 1) * scale));
    this.bakeTexture();
  }

  setContours(on: boolean): void {
    if (on === this.contours) return;
    this.contours = on;
    this.bakeTexture();
  }

  private normalAt(i: number, j: number, out: Float32Array, o: number): void {
    const { resolution: n, cellSize: dx, effective: z } = this.terrain;
    const hx = z[j * n + Math.min(i + 1, n - 1)] - z[j * n + Math.max(i - 1, 0)];
    const hz = z[Math.min(j + 1, n - 1) * n + i] - z[Math.max(j - 1, 0) * n + i];
    const len = Math.hypot(hx, 2 * dx, hz);
    out[o] = -hx / len;
    out[o + 1] = (2 * dx) / len;
    out[o + 2] = -hz / len;
  }

  private normals(): Float32Array {
    const n = this.terrain.resolution;
    const out = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) this.normalAt(i, j, out, 3 * (j * n + i));
    return out;
  }

  /** Samples elevations for texture pixels [p0..p1]×[q0..q1] (clamped). */
  private sampleHeights(p0: number, q0: number, p1: number, q1: number): void {
    const size = this.texSize;
    const px = this.terrain.size / size;
    for (let q = Math.max(0, q0); q <= Math.min(size - 1, q1); q++) {
      for (let p = Math.max(0, p0); p <= Math.min(size - 1, p1); p++) {
        const x = (p + 0.5) * px;
        const z = (q + 0.5) * px;
        const h = this.terrain.heightAt(x, z);
        this.texHeights[q * size + p] = h;
        this.texRaise[q * size + p] = h - this.terrain.baseHeightAt(x, z);
      }
    }
  }

  private bakeTexture(): void {
    const size = this.texSize;
    const [lo, hi] = this.range;
    const relief = Math.max(hi - lo, 1e-3);
    const interval = this.interval;
    const heights = this.texHeights;
    const rgba = this.rgba;
    for (let q = 0; q < size; q++) {
      for (let p = 0; p < size; p++) {
        const k = q * size + p;
        const h = heights[k];
        let [r, g, b] = hypsometric(Math.min(Math.max((h - lo) / relief, 0), 1));
        const raise = this.texRaise[k];
        if (raise > 0.05) {
          const f = Math.min(raise / 1.5, 1) * 0.85;
          r += (EARTHWORK[0] - r) * f;
          g += (EARTHWORK[1] - g) * f;
          b += (EARTHWORK[2] - b) * f;
        }
        if (this.contours) {
          const band = Math.floor(h / interval);
          const right = p + 1 < size ? Math.floor(heights[k + 1] / interval) : band;
          const down = q + 1 < size ? Math.floor(heights[k + size] / interval) : band;
          if (band !== right || band !== down) {
            const major = Math.max(band, right, down) % 5 === 0;
            const f = major ? 0.45 : 0.72;
            r *= f;
            g *= f;
            b *= f;
          }
        }
        rgba[4 * k] = r * 255;
        rgba[4 * k + 1] = g * 255;
        rgba[4 * k + 2] = b * 255;
        rgba[4 * k + 3] = 255;
      }
    }
    if (this.texture && this.texture.getSize().width === size) {
      this.texture.update(rgba);
      return;
    }
    this.texture?.dispose();
    this.texture = RawTexture.CreateRGBATexture(rgba, size, size, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    this.texture.wrapU = this.texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.texture.anisotropicFilteringLevel = 8;
    this.material.diffuseTexture = this.texture;
  }

  dispose(): void {
    this.texture?.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
