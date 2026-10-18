import { describe, expect, it } from "vitest";
import { intersectHeightfield } from "./raymarch";

describe("intersectHeightfield", () => {
	it("hits a flat ground plane", () => {
		const hit = intersectHeightfield(
			{ x: 0, y: 1000, z: 0 },
			{ x: 0.6, y: -0.8, z: 0 },
			() => 0,
			{ maxDistance: 1e6 },
		);
		expect(hit).not.toBeNull();
		expect(hit?.x).toBeCloseTo(750, 0);
		expect(hit?.y).toBeCloseTo(0, 0);
	});

	it("hits a ridge before the ground behind it", () => {
		// Steep ridge (slope 4) between x = 300 and 700, peaking at 800 m.
		const ridge = (x: number) => Math.max(0, 800 - 4 * Math.abs(x - 500));
		const hit = intersectHeightfield(
			{ x: 0, y: 1000, z: 0 },
			{ x: 0.8, y: -0.6, z: 0 },
			(x) => ridge(x),
			{ maxDistance: 1e6 },
		);
		// Ray y = 1000 - 0.75 x meets the rising flank 4 x - 1200 at x = 2200 / 4.75.
		expect(hit?.x).toBeCloseTo(2200 / 4.75, 1);
	});

	it("returns null for rays pointing to the sky or beyond the range", () => {
		expect(
			intersectHeightfield(
				{ x: 0, y: 10, z: 0 },
				{ x: 0, y: 1, z: 0 },
				() => 0,
				{ maxDistance: 1e6 },
			),
		).toBeNull();
		expect(
			intersectHeightfield(
				{ x: 0, y: 1000, z: 0 },
				{ x: 1, y: -0.001, z: 0 },
				() => 0,
				{ maxDistance: 5000 },
			),
		).toBeNull();
	});
});

it("does not invent ground when height coverage is missing", () => {
	expect(
		intersectHeightfield(
			{ x: 0, y: 100, z: 0 },
			{ x: 0, y: -1, z: 0 },
			() => null,
			{ maxDistance: 1000 },
		),
	).toBeNull();
	expect(
		intersectHeightfield(
			{ x: 0, y: 100, z: 0 },
			{ x: 0.8, y: -0.6, z: 0 },
			(x) => (x > 10 ? null : 0),
			{ maxDistance: 1000 },
		),
	).toBeNull();
});
