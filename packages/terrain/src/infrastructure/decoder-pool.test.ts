import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	DecodedHeightTile,
	DecodeRequest,
	DecodeResponse,
} from "./decode-protocol";
import { DecoderPool } from "./decoder-pool";

class DecoderWorkerStub {
	static instances: DecoderWorkerStub[] = [];
	onmessage: ((event: { data: DecodeResponse }) => void) | null = null;
	onerror: ((event: { message: string }) => void) | null = null;
	readonly requests: DecodeRequest[] = [];
	readonly terminate = vi.fn();
	readonly transfers: Transferable[][] = [];

	constructor(
		readonly url: URL,
		readonly options: WorkerOptions,
	) {
		DecoderWorkerStub.instances.push(this);
	}

	postMessage(request: DecodeRequest, transfers: Transferable[]): void {
		this.requests.push(request);
		this.transfers.push(transfers);
	}
}

const tile: DecodedHeightTile = {
	heights: new Uint16Array(4),
	offset: 100,
	width: 2,
	height: 2,
	min: 100,
	max: 100,
};

beforeEach(() => {
	DecoderWorkerStub.instances = [];
	vi.stubGlobal("Worker", DecoderWorkerStub);
});

afterEach(() => vi.unstubAllGlobals());

describe("terrain decoder workers", () => {
	it("uses module worker URLs and transfers buffers to the least busy worker", async () => {
		const pool = new DecoderPool(2);
		const firstBuffer = new ArrayBuffer(4);
		const secondBuffer = new ArrayBuffer(4);
		const firstDecode = pool.decode(firstBuffer);
		const secondDecode = pool.decode(secondBuffer);
		const [firstWorker, secondWorker] = DecoderWorkerStub.instances;
		expect(firstWorker?.url.pathname.endsWith("/decode.worker.ts")).toBe(true);
		expect(firstWorker?.options.type).toBe("module");
		expect(firstWorker?.transfers).toEqual([[firstBuffer]]);
		expect(secondWorker?.transfers).toEqual([[secondBuffer]]);
		firstWorker?.onmessage?.({ data: { id: 0, tile } });
		secondWorker?.onmessage?.({ data: { id: 1, tile } });
		await expect(firstDecode).resolves.toBe(tile);
		await expect(secondDecode).resolves.toBe(tile);
		pool.dispose();
	});

	it("rejects cancelled jobs and cleans abort listeners after the worker finishes", async () => {
		const pool = new DecoderPool(1);
		const controller = new AbortController();
		const removeListener = vi.spyOn(controller.signal, "removeEventListener");
		const decoding = pool.decode(new ArrayBuffer(4), controller.signal);
		controller.abort();
		await expect(decoding).rejects.toMatchObject({ name: "AbortError" });
		DecoderWorkerStub.instances[0]?.onmessage?.({ data: { id: 0, tile } });
		expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
		pool.dispose();
	});

	it("terminates every worker and rejects pending or future work on disposal", async () => {
		const pool = new DecoderPool(2);
		const decoding = pool.decode(new ArrayBuffer(4));
		pool.dispose();
		pool.dispose();
		await expect(decoding).rejects.toThrow("disposed");
		await expect(pool.decode(new ArrayBuffer(4))).rejects.toThrow("disposed");
		for (const worker of DecoderWorkerStub.instances)
			expect(worker.terminate).toHaveBeenCalledTimes(1);
	});

	it("rejects failed jobs and replaces a crashed worker for later requests", async () => {
		const pool = new DecoderPool(1);
		const decoding = pool.decode(new ArrayBuffer(4));
		const crashedWorker = DecoderWorkerStub.instances[0];
		crashedWorker?.onerror?.({ message: "decoder crashed" });
		await expect(decoding).rejects.toThrow("decoder crashed");
		expect(crashedWorker?.terminate).toHaveBeenCalledTimes(1);
		const recoveredDecode = pool.decode(new ArrayBuffer(4));
		DecoderWorkerStub.instances[1]?.onmessage?.({ data: { id: 1, tile } });
		await expect(recoveredDecode).resolves.toBe(tile);
		pool.dispose();
	});
});
