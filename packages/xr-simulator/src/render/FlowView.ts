import {
  BoundingInfo, Color3, Mesh, StandardMaterial, Vector3, VertexBuffer, type AbstractEngine, type Scene, type TransformNode,
} from '@babylonjs/core';
import type { SurfaceBuffers } from '../solver/gpu/LocalGpuSolver';
import { gridIndices } from './TerrainView';
import { writeSurfaceCpu, type SurfaceInputs } from './surfaceCpu';

/**
 * Flow surface mesh. On WebGPU its vertex buffers ARE the storage buffers the
 * surface kernel writes, so solver output reaches the screen without any CPU
 * round trip. The plan-B path fills ordinary vertex buffers from the CPU solver.
 */
export class FlowView {
  readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private cpu: { positions: Float32Array; normals: Float32Array; colors: Float32Array } | null = null;

  constructor(scene: Scene, root: TransformNode, n: number, size: number, zRange: [number, number]) {
    this.mesh = new Mesh('flow', scene);
    this.mesh.parent = root;
    this.mesh.isPickable = false;
    this.material = new StandardMaterial('flow-mat', scene);
    this.material.backFaceCulling = false;
    this.material.specularColor = new Color3(0.25, 0.22, 0.18);
    this.material.specularPower = 48;
    this.material.zOffset = -2;
    this.mesh.material = this.material;
    this.mesh.hasVertexAlpha = true;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.indices = gridIndices(n);
    this.n = n;
    this.bounds = new BoundingInfo(new Vector3(0, zRange[0] - 10, 0), new Vector3(size, zRange[1] + 100, size));
  }

  private readonly indices: Uint32Array;
  private readonly n: number;
  private readonly bounds: BoundingInfo;

  /** Binds the GPU solver's surface storage buffers as vertex buffers. */
  bindGpu(engine: AbstractEngine, surface: SurfaceBuffers): void {
    const count = this.n * this.n;
    const vb = (buf: SurfaceBuffers['positions'], kind: string, size: number) =>
      new VertexBuffer(engine, buf.getBuffer(), kind, false, false, 4, false, 0, size);
    this.mesh.setVerticesBuffer(vb(surface.positions, VertexBuffer.PositionKind, 3), true, count);
    this.mesh.setVerticesBuffer(vb(surface.normals, VertexBuffer.NormalKind, 3), true, count);
    this.mesh.setVerticesBuffer(vb(surface.colors, VertexBuffer.ColorKind, 4), true, count);
    this.mesh.setIndices(this.indices, count);
    this.mesh.setBoundingInfo(this.bounds);
    this.mesh.doNotSyncBoundingInfo = true;
  }

  /** Allocates CPU-side vertex buffers for the plan-B path. */
  bindCpu(): void {
    const count = this.n * this.n;
    this.cpu = { positions: new Float32Array(count * 3), normals: new Float32Array(count * 3), colors: new Float32Array(count * 4) };
    this.mesh.setVerticesData(VertexBuffer.PositionKind, this.cpu.positions, true);
    this.mesh.setVerticesData(VertexBuffer.NormalKind, this.cpu.normals, true);
    this.mesh.setVerticesData(VertexBuffer.ColorKind, this.cpu.colors, true, 4);
    this.mesh.setIndices(this.indices, count);
    this.mesh.setBoundingInfo(this.bounds);
    this.mesh.doNotSyncBoundingInfo = true;
  }

  updateFromCpu(inputs: SurfaceInputs): void {
    if (!this.cpu) return;
    writeSurfaceCpu(inputs, this.cpu.positions, this.cpu.normals, this.cpu.colors);
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.cpu.positions, false, false);
    this.mesh.updateVerticesData(VertexBuffer.NormalKind, this.cpu.normals, false, false);
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, this.cpu.colors, false, false);
  }

  dispose(): void {
    this.material.dispose();
    this.mesh.dispose();
  }
}
