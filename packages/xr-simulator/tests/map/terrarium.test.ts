import { describe, expect, it } from "vitest";
import {
	decodeTerrarium,
	isNodata,
	terrariumHeight,
} from "../../src/map/terrarium";

describe("Terrarium decode", () => {
	it("decodes h = R*256 + G + B/256 - 32768", () => {
		expect(terrariumHeight(128, 0, 0)).toBe(0);
		expect(terrariumHeight(154, 85, 128)).toBeCloseTo(6741.5, 6);
		expect(terrariumHeight(127, 255, 0)).toBe(-1);
	});

	it("turns nodata (RGB 0,0,0) into NaN and keeps valid pixels", () => {
		const rgba = new Uint8Array([
			128, 0, 0, 255, 0, 0, 0, 255, 128, 100, 0, 255, 0, 0, 0, 0,
		]);
		const h = decodeTerrarium(rgba, 2, 2);
		expect(h[0]).toBe(0);
		expect(Number.isNaN(h[1])).toBe(true);
		expect(h[2]).toBe(100);
		expect(Number.isNaN(h[3])).toBe(true);
	});

	it("treats h <= -32767 as nodata", () => {
		expect(isNodata(-32768)).toBe(true);
		expect(isNodata(-32767)).toBe(true);
		expect(isNodata(-32766)).toBe(false);
		expect(isNodata(Number.NaN)).toBe(true);
	});

	it("rejects a buffer of the wrong size", () => {
		expect(() => decodeTerrarium(new Uint8Array(8), 2, 2)).toThrow();
	});
});
