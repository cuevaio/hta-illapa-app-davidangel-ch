import { describe, expect, it } from "vitest";
import { createLocalFrame, localToLonLat, lonLatToLocal } from "./local-frame";

describe("local metric frame", () => {
	const frame = createLocalFrame(-75, -9.5);

	it("places the origin at (0, 0)", () => {
		const localPoint = lonLatToLocal(frame, -75, -9.5);
		expect(localPoint.x).toBeCloseTo(0, 6);
		expect(localPoint.z).toBeCloseTo(0, 6);
	});

	it("points east to +x and north to -z", () => {
		const east = lonLatToLocal(frame, -74, -9.5);
		const north = lonLatToLocal(frame, -75, -8.5);
		expect(east.x).toBeGreaterThan(0);
		expect(north.z).toBeLessThan(0);
	});

	it("uses true meters at the origin latitude", () => {
		// One degree of longitude at latitude 9.5 is ~109.8 km.
		const east = lonLatToLocal(frame, -74, -9.5);
		expect(east.x / 1000).toBeCloseTo(109.8, 0);
	});

	it("round-trips lon/lat", () => {
		const localPoint = lonLatToLocal(frame, -71.97, -13.53);
		const geographicPoint = localToLonLat(frame, localPoint.x, localPoint.z);
		expect(geographicPoint.lon).toBeCloseTo(-71.97, 9);
		expect(geographicPoint.lat).toBeCloseTo(-13.53, 9);
	});
});
