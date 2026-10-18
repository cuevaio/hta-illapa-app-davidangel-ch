import { describe, expect, it } from "vitest";
import { decodeTerrarium, terrariumHeight } from "./terrarium";

describe("Terrarium decoding", () => {
	it("decodes sea level (R=128, G=0, B=0) to 0 m", () => {
		expect(terrariumHeight(128, 0, 0)).toBe(0);
	});

	it("applies height = R*256 + G + B/256 - 32768", () => {
		expect(terrariumHeight(150, 184, 128)).toBeCloseTo(
			150 * 256 + 184 + 0.5 - 32768,
			6,
		);
		expect(terrariumHeight(0, 0, 0)).toBe(-32768);
	});

	it("decodes an RGBA buffer into a Float32Array with min/max", () => {
		const rgba = new Uint8ClampedArray([
			128, 0, 0, 255, 150, 184, 128, 255, 127, 255, 0, 255, 128, 10, 0, 255,
		]);
		const out = decodeTerrarium(rgba, 2, 2);
		expect(out.heights).toBeInstanceOf(Float32Array);
		expect(Array.from(out.heights)).toEqual([0, 5816.5, -1, 10]);
		expect(out.min).toBe(-1);
		expect(out.max).toBe(5816.5);
	});

	it("rejects buffers whose size does not match the dimensions", () => {
		expect(() => decodeTerrarium(new Uint8ClampedArray(8), 2, 2)).toThrow();
	});
});
