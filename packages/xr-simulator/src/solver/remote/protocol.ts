import type { Scenario } from "../../scenario/scenario";

/**
 * Remote solver protocol (skeleton; no server exists yet).
 *
 *   POST   {base}/simulations                 body: Scenario JSON + options  → { "id": "<job>" }
 *   WS     {base}/simulations/{id}/frames      binary messages, one RemoteFrame each, in time order
 *   DELETE {base}/simulations/{id}             cancels the job
 *
 * A frame carries three float32 rasters on the solver grid (row-major, index = j·n + i): flow depth h (m)
 * and depth-averaged velocity u, v (m/s) along x and z. They are textures in the GPU sense: the client
 * can upload each one as an R32F texture, or feed them to the CPU surface path as the app does now.
 */
export interface RemoteFrame {
	simTime: number;
	resolution: number;
	h: Float32Array;
	u: Float32Array;
	v: Float32Array;
}

export interface SubmitOptions {
	/** Cells per side the server should compute (may be higher than the client's live grid). */
	resolution: number;
	/** Simulated seconds between frames. */
	frameInterval: number;
	/** Simulated time to compute (s). */
	duration: number;
}

export interface RemoteTransport {
	submit(scenario: Scenario, options: SubmitOptions): Promise<string>;
	/** Frames of a job in time order; ends when the job completes or is cancelled. */
	frames(jobId: string): AsyncIterable<RemoteFrame>;
	cancel(jobId: string): Promise<void>;
}

/** Binary frame: "HUFR", version u32, resolution u32, pad u32, simTime f64, then h, u, v (float32, little-endian). */
const MAGIC = 0x52465548; // "HUFR" read as little-endian u32
const VERSION = 1;
const HEADER = 24;

export function encodeFrame(f: RemoteFrame): ArrayBuffer {
	const cells = f.resolution * f.resolution;
	const buf = new ArrayBuffer(HEADER + 3 * cells * 4);
	const view = new DataView(buf);
	view.setUint32(0, MAGIC, true);
	view.setUint32(4, VERSION, true);
	view.setUint32(8, f.resolution, true);
	view.setFloat64(16, f.simTime, true);
	const data = new Float32Array(buf, HEADER, 3 * cells);
	data.set(f.h, 0);
	data.set(f.u, cells);
	data.set(f.v, 2 * cells);
	return buf;
}

export function decodeFrame(buf: ArrayBuffer): RemoteFrame {
	const view = new DataView(buf);
	if (buf.byteLength < HEADER || view.getUint32(0, true) !== MAGIC)
		throw new Error("Not a remote solver frame");
	if (view.getUint32(4, true) !== VERSION)
		throw new Error(`Unsupported frame version ${view.getUint32(4, true)}`);
	const resolution = view.getUint32(8, true);
	if (resolution < 1) throw new Error("Remote solver frame with resolution 0");
	const cells = resolution * resolution;
	if (buf.byteLength !== HEADER + 3 * cells * 4)
		throw new Error("Truncated remote solver frame");
	const data = new Float32Array(buf.slice(HEADER));
	return {
		simTime: view.getFloat64(16, true),
		resolution,
		h: data.slice(0, cells),
		u: data.slice(cells, 2 * cells),
		v: data.slice(2 * cells),
	};
}
