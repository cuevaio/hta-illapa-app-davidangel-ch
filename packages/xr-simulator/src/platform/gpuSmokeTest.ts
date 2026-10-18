/** Result of a trivial compute dispatch, used to prove the GPU path end to end. */
export interface ComputeTestResult {
  ok: boolean;
  elements: number;
  mismatches: number;
  sample: number[];
  millis: number;
  error?: string;
}

export const SMOKE_ELEMENTS = 4096;

/** WGSL: out[i] = in[i] * 2 + 1. Shared by the raw WebGPU and Babylon tests. */
export const SMOKE_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> src : array<f32>;
@group(0) @binding(1) var<storage, read_write> dst : array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let i = id.x;
  if (i >= arrayLength(&dst)) { return; }
  dst[i] = src[i] * 2.0 + 1.0;
}
`;

export function smokeInput(): Float32Array<ArrayBuffer> {
  return Float32Array.from({ length: SMOKE_ELEMENTS }, (_, i) => i * 0.5);
}

export function checkSmokeOutput(input: Float32Array, output: Float32Array, millis: number): ComputeTestResult {
  let mismatches = 0;
  for (let i = 0; i < input.length; i++) {
    if (output[i] !== input[i] * 2 + 1) mismatches++;
  }
  return { ok: mismatches === 0, elements: input.length, mismatches, sample: [...output.slice(0, 4)], millis };
}

/** Runs the smoke test directly on `navigator.gpu`, without any engine. */
export async function runRawWebGpuComputeTest(): Promise<ComputeTestResult> {
  const t0 = performance.now();
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter');
    const device = await adapter.requestDevice();
    const input = smokeInput();
    const bytes = input.byteLength;
    const src = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const dst = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(src, 0, input);
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: SMOKE_WGSL }), entryPoint: 'main' },
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: src } },
        { binding: 1, resource: { buffer: dst } },
      ],
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(SMOKE_ELEMENTS / 64));
    pass.end();
    encoder.copyBufferToBuffer(dst, 0, staging, 0, bytes);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const output = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    device.destroy();
    return checkSmokeOutput(input, output, performance.now() - t0);
  } catch (err) {
    return { ok: false, elements: SMOKE_ELEMENTS, mismatches: -1, sample: [], millis: performance.now() - t0, error: String(err) };
  }
}
