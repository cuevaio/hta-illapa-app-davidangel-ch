import { describe, expect, it } from "vitest";
import { formatStructureLength, structureLengthM } from "./geometry";

describe("structure length", () => {
	it("measures bridge and tunnel endpoints in three dimensions", () => {
		for (const kind of ["bridge", "tunnel"] satisfies ("bridge" | "tunnel")[])
			expect(
				structureLengthM({
					kind,
					start: { x: 0, y: 0, z: 0 },
					end: { x: 3, y: 4, z: 0 },
				}),
			).toBe(5);
	});
	it("sums bypass segments and handles an entity", () => {
		expect(
			structureLengthM({
				kind: "bypass",
				points: [
					{ x: 0, y: 0, z: 0 },
					{ x: 3, y: 4, z: 0 },
					{ x: 3, y: 4, z: 12 },
				],
			}),
		).toBe(17);
		expect(structureLengthM({ kind: "entity" })).toBe(0);
	});
});

describe("structure length labels", () => {
	it.each([
		{ lengthM: 128.022, locale: "es", expected: "128,0 m" },
		{ lengthM: 999.9, locale: "en", expected: "999.9 m" },
		{ lengthM: 1000, locale: "es", expected: "1,0 km" },
		{ lengthM: 1500.1, locale: "en", expected: "1.5 km" },
	])("formats $lengthM metres in $locale", ({ lengthM, locale, expected }) => {
		expect(formatStructureLength(lengthM, locale)).toBe(expected);
	});
});
