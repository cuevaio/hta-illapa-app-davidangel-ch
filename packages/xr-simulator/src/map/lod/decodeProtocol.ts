import { type PreparedTile, prepareTile } from "./tileData";

export interface DecodeRequest {
	id: number;
	buffer: ArrayBuffer;
	segments: number;
}

export type DecodeResponse =
	| { id: number; ok: true; tile: PreparedTile }
	| { id: number; ok: false; error: string };

/** PNG bytes → prepared tile. Exact RGB: no colour-space conversion nor premultiplication. */
export async function decodeRequestToTile(
	req: DecodeRequest,
): Promise<PreparedTile> {
	const bmp = await createImageBitmap(
		new Blob([req.buffer], { type: "image/png" }),
		{ colorSpaceConversion: "none", premultiplyAlpha: "none" },
	);
	const { width, height } = bmp;
	const canvas = new OffscreenCanvas(width, height);
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx)
		throw new Error("Contexto 2D no disponible para decodificar el tile");
	ctx.drawImage(bmp, 0, 0);
	bmp.close();
	return prepareTile(
		ctx.getImageData(0, 0, width, height).data,
		width,
		height,
		req.segments,
	);
}
