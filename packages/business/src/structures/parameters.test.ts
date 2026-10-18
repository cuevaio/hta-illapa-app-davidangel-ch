import { describe, expect, it } from "vitest";
import { parseStructureNumber } from "./parameters";

describe("structure numeric input", () => {
	it.each(["es", "es-PE", "en"])("accepts decimal input in %s", (locale) => {
		expect(parseStructureNumber("2,5", locale)).toBe(2.5);
		expect(parseStructureNumber("2.5", locale)).toBe(2.5);
	});
	it("leaves invalid input detectable", () => {
		expect(Number.isNaN(parseStructureNumber("not a number", "es"))).toBe(true);
	});
});
