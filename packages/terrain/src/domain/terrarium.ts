import {
	RGBA_CHANNELS_COUNT,
	TERRARIUM_CHANNEL_RANGE_COUNT,
	TERRARIUM_HEIGHT_OFFSET_M,
} from "../constants";
export interface DecodedHeights {
	heights: Float32Array;
	min: number;
	max: number;
}

/** Terrarium encoding: height = R * TERRARIUM_CHANNEL_RANGE_COUNT + G + B / TERRARIUM_CHANNEL_RANGE_COUNT - TERRARIUM_HEIGHT_OFFSET_M (meters). */
export function terrariumHeight(
	red: number,
	green: number,
	blue: number,
): number {
	return (
		red * TERRARIUM_CHANNEL_RANGE_COUNT +
		green +
		blue / TERRARIUM_CHANNEL_RANGE_COUNT -
		TERRARIUM_HEIGHT_OFFSET_M
	);
}

export function decodeTerrarium(
	rgba: ArrayLike<number>,
	width: number,
	height: number,
): DecodedHeights {
	const count = width * height;
	if (rgba.length !== count * RGBA_CHANNELS_COUNT) {
		throw new Error(
			`Expected ${count * RGBA_CHANNELS_COUNT} RGBA bytes, got ${rgba.length}`,
		);
	}
	const heights = new Float32Array(count);
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (let pixelIndex = 0; pixelIndex < count; pixelIndex++) {
		const byteOffset = pixelIndex * RGBA_CHANNELS_COUNT;
		const elevation = terrariumHeight(
			Number(rgba[byteOffset]),
			Number(rgba[byteOffset + 1]),
			Number(rgba[byteOffset + 2]),
		);
		heights[pixelIndex] = elevation;
		if (elevation < min) min = elevation;
		if (elevation > max) max = elevation;
	}
	return { heights, min, max };
}
