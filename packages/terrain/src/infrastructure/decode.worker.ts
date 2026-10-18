/// <reference lib="webworker" />
import { encodeHalfHeights } from "../domain/half-float";
import { decodeTerrarium } from "../domain/terrarium";
import type { DecodeRequest, DecodeResponse } from "./decode-protocol";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (event: MessageEvent<DecodeRequest>) => {
	const { id, buffer } = event.data;
	let bitmap: ImageBitmap | undefined;
	try {
		// Disable color management and premultiplication: pixel values encode heights.
		bitmap = await createImageBitmap(
			new Blob([buffer], { type: "image/png" }),
			{
				colorSpaceConversion: "none",
				premultiplyAlpha: "none",
			},
		);
		const { width, height } = bitmap;
		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext("2d", { willReadFrequently: true });
		if (!context) throw new Error("2D context unavailable in worker");
		context.drawImage(bitmap, 0, 0);
		const decoded = decodeTerrarium(
			context.getImageData(0, 0, width, height).data,
			width,
			height,
		);
		// Relative to the tile minimum, half-floats keep sub-meter precision for typical tile relief.
		const offset = Number.isFinite(decoded.min) ? decoded.min : 0;
		const heights = encodeHalfHeights(decoded.heights, offset);
		const response: DecodeResponse = {
			id,
			tile: { ...decoded, heights, offset, width, height },
		};
		self.postMessage(response, [heights.buffer]);
	} catch (error) {
		const response: DecodeResponse = { id, error: String(error) };
		self.postMessage(response);
	} finally {
		bitmap?.close();
	}
};
