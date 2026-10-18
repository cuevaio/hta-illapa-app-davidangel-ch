import { Engine, WebGPUEngine, type AbstractEngine } from '@babylonjs/core';

export interface EngineHandle {
  engine: AbstractEngine;
  webgpu: boolean;
}

/** WebGPU engine (XR-compatible) or a WebGL2 engine for the CPU plan-B path. */
export async function createEngine(canvas: HTMLCanvasElement, useWebGPU: boolean): Promise<EngineHandle> {
  if (useWebGPU) {
    const engine = new WebGPUEngine(canvas, { xrCompatible: true, antialias: true, adaptToDeviceRatio: true });
    try {
      await engine.initAsync();
      return { engine, webgpu: true };
    } catch (err) {
      console.warn('WebGPU init failed, falling back to WebGL2', err);
      engine.dispose();
    }
  }
  const engine = new Engine(canvas, true, { xrCompatible: true, adaptToDeviceRatio: true });
  return { engine, webgpu: false };
}
