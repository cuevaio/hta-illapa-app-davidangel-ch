import { describe, expect, it } from "vitest";
import { KIND_LABEL } from "../../src/map/weather/catalog";
import { rangeFillPercent, weatherBadgeClass } from "../../src/ui/web/mayu";

describe("weatherBadgeClass (DESIGN.md Status badges, S14)", () => {
	it("observed data is a measurement: the success badge", () => {
		expect(weatherBadgeClass(KIND_LABEL.observed)).toBe("badge badge-success");
	});

	it("a forecast is model information: the info badge", () => {
		expect(weatherBadgeClass(KIND_LABEL.forecast)).toBe("badge badge-info");
	});
});

describe("rangeFillPercent (web Slider range)", () => {
	it("is the share of the track from min to the value", () => {
		expect(rangeFillPercent(3, 1, 5)).toBe(50);
		expect(rangeFillPercent(0, 0, 1)).toBe(0);
		expect(rangeFillPercent(1, 0, 1)).toBe(100);
	});

	it("stays within the track and handles an empty range", () => {
		expect(rangeFillPercent(9, 0, 4)).toBe(100);
		expect(rangeFillPercent(-1, 0, 4)).toBe(0);
		expect(rangeFillPercent(0, 0, 0)).toBe(0);
	});
});
