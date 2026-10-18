import { StorageBuffer } from '@babylonjs/core/Buffers/storageBuffer';
import { ComputeShader } from '@babylonjs/core/Compute/computeShader';
import { Constants } from '@babylonjs/core/Engines/constants';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
// Side effect: registers compute support on WebGPUEngine (not pulled in by deep imports).
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.computeShader';
import { checkSmokeOutput, smokeInput, SMOKE_ELEMENTS, SMOKE_WGSL, type ComputeTestResult } from './gpuSmokeTest';

/** Same smoke test as the raw one, but through Babylon's ComputeShader/StorageBuffer. */
export async function runBabylonComputeTest(): Promise<ComputeTestResult> {
  const t0 = performance.now();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  let engine: WebGPUEngine | undefined;
  try {
    engine = new WebGPUEngine(canvas, { xrCompatible: true });
    await engine.initAsync();
    const input = smokeInput();
    // WRITE is required for update(): without it the buffer lacks COPY_DST and uploads are silently dropped.
    const flags = Constants.BUFFER_CREATIONFLAG_STORAGE | Constants.BUFFER_CREATIONFLAG_READ | Constants.BUFFER_CREATIONFLAG_WRITE;
    const src = new StorageBuffer(engine, input.byteLength, flags);
    const dst = new StorageBuffer(engine, input.byteLength, flags);
    src.update(input);
    const cs = new ComputeShader('smoke', engine, { computeSource: SMOKE_WGSL }, {
      bindingsMapping: { src: { group: 0, binding: 0 }, dst: { group: 0, binding: 1 } },
    });
    cs.setStorageBuffer('src', src);
    cs.setStorageBuffer('dst', dst);
    await cs.dispatchWhenReady(Math.ceil(SMOKE_ELEMENTS / 64));
    const view = await dst.read(undefined, undefined, undefined, true);
    const output = new Float32Array(view.buffer, view.byteOffset, SMOKE_ELEMENTS);
    return checkSmokeOutput(input, output, performance.now() - t0);
  } catch (err) {
    return { ok: false, elements: SMOKE_ELEMENTS, mismatches: -1, sample: [], millis: performance.now() - t0, error: String(err) };
  } finally {
    engine?.dispose();
  }
}
