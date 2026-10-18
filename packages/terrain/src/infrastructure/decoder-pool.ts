import {
	DEFAULT_HARDWARE_THREADS_COUNT,
	MAX_DECODE_WORKERS_COUNT,
} from "../constants";
import type {
	DecodedHeightTile,
	DecodeRequest,
	DecodeResponse,
} from "./decode-protocol";

interface DecoderWorker {
	worker: Worker;
	load: number;
}

interface PendingDecode {
	resolve: (tile: DecodedHeightTile) => void;
	reject: (error: Error) => void;
	decoder: DecoderWorker;
	removeAbortListener: () => void;
}

export class DecoderPool {
	private readonly decoders: DecoderWorker[] = [];
	private readonly pending = new Map<number, PendingDecode>();
	private nextRequestId = 0;
	private disposed = false;

	constructor(
		size = Math.max(
			1,
			Math.min(
				MAX_DECODE_WORKERS_COUNT,
				(navigator.hardwareConcurrency || DEFAULT_HARDWARE_THREADS_COUNT) - 1,
			),
		),
	) {
		for (let workerIndex = 0; workerIndex < size; workerIndex++) {
			const decoder = { worker: this.createWorker(), load: 0 };
			this.decoders.push(decoder);
			this.connect(decoder);
		}
	}

	decode(
		buffer: ArrayBuffer,
		signal?: AbortSignal,
	): Promise<DecodedHeightTile> {
		if (this.disposed)
			return Promise.reject(new Error("Decoder pool disposed"));
		if (signal?.aborted)
			return Promise.reject(new DOMException("Aborted", "AbortError"));
		let decoder: DecoderWorker | undefined;
		for (const candidate of this.decoders) {
			if (!decoder || candidate.load < decoder.load) decoder = candidate;
		}
		if (!decoder)
			return Promise.reject(new Error("No terrain decoder workers available"));
		const selectedDecoder = decoder;
		const id = this.nextRequestId++;
		selectedDecoder.load++;
		return new Promise((resolve, reject) => {
			// Workers cannot be interrupted mid-decode; an abort just discards the result.
			const abort = () => reject(new DOMException("Aborted", "AbortError"));
			const removeAbortListener = () =>
				signal?.removeEventListener("abort", abort);
			signal?.addEventListener("abort", abort, { once: true });
			this.pending.set(id, {
				resolve,
				reject,
				decoder: selectedDecoder,
				removeAbortListener,
			});
			const request: DecodeRequest = { id, buffer };
			try {
				selectedDecoder.worker.postMessage(request, [buffer]);
			} catch (error) {
				this.pending.delete(id);
				selectedDecoder.load--;
				removeAbortListener();
				reject(error);
			}
		});
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const decoder of this.decoders) decoder.worker.terminate();
		for (const pending of this.pending.values()) {
			pending.removeAbortListener();
			pending.reject(new Error("Decoder pool disposed"));
		}
		this.pending.clear();
		this.decoders.length = 0;
	}

	private createWorker(): Worker {
		return new Worker(new URL("./decode.worker.ts", import.meta.url), {
			type: "module",
		});
	}

	private connect(decoder: DecoderWorker): void {
		decoder.worker.onmessage = (event: MessageEvent<DecodeResponse>) => {
			const pending = this.pending.get(event.data.id);
			if (!pending) return;
			this.pending.delete(event.data.id);
			pending.decoder.load--;
			pending.removeAbortListener();
			if (event.data.tile) pending.resolve(event.data.tile);
			else
				pending.reject(new Error(event.data.error ?? "Terrain decode failed"));
		};
		decoder.worker.onerror = (event) => {
			for (const [id, pending] of this.pending) {
				if (pending.decoder !== decoder) continue;
				this.pending.delete(id);
				pending.removeAbortListener();
				pending.reject(
					new Error(event.message || "Terrain decoder worker failed"),
				);
			}
			decoder.load = 0;
			decoder.worker.terminate();
			if (!this.disposed) {
				decoder.worker = this.createWorker();
				this.connect(decoder);
			}
		};
	}
}
