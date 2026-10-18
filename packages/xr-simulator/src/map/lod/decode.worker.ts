/// <reference lib="webworker" />
import {
	type DecodeRequest,
	type DecodeResponse,
	decodeRequestToTile,
} from "./decodeProtocol";

declare const self: DedicatedWorkerGlobalScope;

/** Terrarium PNG → R16F bits + vertex grid off the main thread (buffers are transferred). */
self.onmessage = async (event: MessageEvent<DecodeRequest>) => {
	const { id } = event.data;
	try {
		const tile = await decodeRequestToTile(event.data);
		const response: DecodeResponse = { id, ok: true, tile };
		self.postMessage(response, [
			tile.bits.buffer as ArrayBuffer,
			tile.grid.buffer as ArrayBuffer,
		]);
	} catch (err) {
		const response: DecodeResponse = { id, ok: false, error: String(err) };
		self.postMessage(response);
	}
};
