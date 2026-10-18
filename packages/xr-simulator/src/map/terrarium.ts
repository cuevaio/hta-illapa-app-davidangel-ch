/** Terrarium height encoding used by our tiles API: h = R*256 + G + B/256 - 32768 (m). */
export function terrariumHeight(r: number, g: number, b: number): number {
	return r * 256 + g + b / 256 - 32768;
}

/** Nodata is RGB (0,0,0), which decodes to -32768; clients treat h <= -32767 (or NaN) as nodata. */
export function isNodata(h: number): boolean {
	return !(h > -32767);
}

/** Decodes RGBA pixels to heights; nodata pixels become NaN. */
export function decodeTerrarium(
	rgba: ArrayLike<number>,
	width: number,
	height: number,
): Float32Array {
	const count = width * height;
	if (rgba.length !== count * 4)
		throw new Error(
			`Se esperaban ${count * 4} bytes RGBA y llegaron ${rgba.length}`,
		);
	const out = new Float32Array(count);
	for (let k = 0; k < count; k++) {
		const h = terrariumHeight(rgba[4 * k], rgba[4 * k + 1], rgba[4 * k + 2]);
		out[k] = isNodata(h) ? Number.NaN : h;
	}
	return out;
}
