// IEEE 754 binary16 conversion for R16F height textures (after peru-simulator's half-float.ts).
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** Number to half-float bits, rounding to nearest even. */
export function toHalfFloat(value: number): number {
	f32[0] = value;
	const bits = u32[0];
	const sign = (bits >>> 16) & 0x8000;
	const exponent = (bits >>> 23) & 0xff;
	let mantissa = bits & 0x7fffff;
	if (exponent === 0xff) return sign | 0x7c00 | (mantissa ? 0x200 : 0);
	const e = exponent - 127 + 15;
	if (e >= 0x1f) return sign | 0x7c00;
	if (e <= 0) {
		if (e < -10) return sign;
		mantissa |= 0x800000;
		const shift = 14 - e;
		let half = mantissa >>> shift;
		const rest = mantissa & ((1 << shift) - 1);
		const mid = 1 << (shift - 1);
		if (rest > mid || (rest === mid && half & 1)) half++;
		return sign | half;
	}
	let out = sign | (e << 10) | (mantissa >>> 13);
	const rest = mantissa & 0x1fff;
	if (rest > 0x1000 || (rest === 0x1000 && out & 1)) out++;
	return out;
}

export function fromHalfFloat(bits: number): number {
	const sign = bits & 0x8000 ? -1 : 1;
	const exponent = (bits >> 10) & 0x1f;
	const mantissa = bits & 0x3ff;
	if (exponent === 0) return sign * mantissa * 2 ** -24;
	if (exponent === 0x1f)
		return mantissa ? Number.NaN : sign * Number.POSITIVE_INFINITY;
	return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}
