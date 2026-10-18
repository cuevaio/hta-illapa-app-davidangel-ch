import {
	FLOAT32_EXPONENT_BIAS_COUNT,
	FLOAT32_EXPONENT_MASK_BITS,
	FLOAT32_EXPONENT_SHIFT_BITS,
	FLOAT32_HIDDEN_MANTISSA_BITS,
	FLOAT32_MANTISSA_MASK_BITS,
	FLOAT32_SIGN_SHIFT_BITS,
	HALF_EXPONENT_BIAS_COUNT,
	HALF_EXPONENT_MASK_BITS,
	HALF_INFINITY_BITS,
	HALF_MANTISSA_MASK_BITS,
	HALF_MANTISSA_RANGE_COUNT,
	HALF_MANTISSA_WIDTH_BITS,
	HALF_NAN_MANTISSA_BITS,
	HALF_ROUND_MASK_BITS,
	HALF_ROUND_MIDPOINT_BITS,
	HALF_ROUND_SHIFT_BITS,
	HALF_SIGN_MASK_BITS,
	HALF_SUBNORMAL_EXPONENT_COUNT,
	HALF_SUBNORMAL_SHIFT_BITS,
} from "../constants";

// IEEE 754 binary16 conversion, used to halve the memory of height textures.
const floatView = new DataView(new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT));

/** Converts a number to half-float bits, rounding to nearest even. */
export function toHalfFloat(value: number): number {
	floatView.setFloat32(0, value);
	const bits = floatView.getUint32(0);
	const sign = (bits >>> FLOAT32_SIGN_SHIFT_BITS) & HALF_SIGN_MASK_BITS;
	const exponent =
		(bits >>> FLOAT32_EXPONENT_SHIFT_BITS) & FLOAT32_EXPONENT_MASK_BITS;
	let mantissa = bits & FLOAT32_MANTISSA_MASK_BITS;
	if (exponent === FLOAT32_EXPONENT_MASK_BITS)
		return sign | HALF_INFINITY_BITS | (mantissa ? HALF_NAN_MANTISSA_BITS : 0);
	const halfExponent =
		exponent - FLOAT32_EXPONENT_BIAS_COUNT + HALF_EXPONENT_BIAS_COUNT;
	if (halfExponent >= HALF_EXPONENT_MASK_BITS) return sign | HALF_INFINITY_BITS;
	if (halfExponent <= 0) {
		// Subnormal half (or zero).
		if (halfExponent < -HALF_MANTISSA_WIDTH_BITS) return sign;
		mantissa |= FLOAT32_HIDDEN_MANTISSA_BITS;
		const shift = HALF_SUBNORMAL_SHIFT_BITS - halfExponent;
		let half = mantissa >>> shift;
		const rest = mantissa & ((1 << shift) - 1);
		const midpoint = 1 << (shift - 1);
		if (rest > midpoint || (rest === midpoint && half & 1)) half++;
		return sign | half;
	}
	let encoded =
		sign |
		(halfExponent << HALF_MANTISSA_WIDTH_BITS) |
		(mantissa >>> HALF_ROUND_SHIFT_BITS);
	const rest = mantissa & HALF_ROUND_MASK_BITS;
	// A carry into the exponent is correct (and overflows to infinity at the top).
	if (
		rest > HALF_ROUND_MIDPOINT_BITS ||
		(rest === HALF_ROUND_MIDPOINT_BITS && encoded & 1)
	)
		encoded++;
	return encoded;
}

export function fromHalfFloat(bits: number): number {
	const sign = bits & HALF_SIGN_MASK_BITS ? -1 : 1;
	const exponent = (bits >> HALF_MANTISSA_WIDTH_BITS) & HALF_EXPONENT_MASK_BITS;
	const mantissa = bits & HALF_MANTISSA_MASK_BITS;
	if (exponent === 0)
		return sign * mantissa * 2 ** HALF_SUBNORMAL_EXPONENT_COUNT;
	if (exponent === HALF_EXPONENT_MASK_BITS)
		return mantissa ? Number.NaN : sign * Number.POSITIVE_INFINITY;
	return (
		sign *
		(1 + mantissa / HALF_MANTISSA_RANGE_COUNT) *
		2 ** (exponent - HALF_EXPONENT_BIAS_COUNT)
	);
}

/**
 * Encodes heights as half-floats relative to `offset` (normally the tile
 * minimum). Precision then depends on the tile's relief, not its altitude:
 * below 2048 m of relief the error stays within 0.5 m.
 */
export function encodeHalfHeights(
	heights: Float32Array,
	offset: number,
): Uint16Array {
	const encoded = new Uint16Array(heights.length);
	for (const [heightIndex, elevation] of heights.entries())
		encoded[heightIndex] = toHalfFloat(elevation - offset);
	return encoded;
}
