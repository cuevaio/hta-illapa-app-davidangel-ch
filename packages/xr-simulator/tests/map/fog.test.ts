import { describe, expect, it } from "vitest";
import { FOG_DENSITY_PER_KM } from "../../src/map/constants";
import { fogDensityAt } from "../../src/map/fog";

const fogAt = (distanceKm: number, density: number) =>
	1 - Math.exp(-((distanceKm * density) ** 2));

describe("fogDensityAt (overview fog by view distance, S11)", () => {
	it("keeps the full atmospheric depth for near-ground views", () => {
		for (const viewKm of [0.5, 5, 50, 300])
			expect(fogDensityAt(viewKm)).toBe(FOG_DENSITY_PER_KM);
	});

	it("leaves all of Peru clear at the full-country framing, portrait radius included", () => {
		for (const radiusKm of [3400, 5000]) {
			const density = fogDensityAt(radiusKm);
			expect(fogAt(radiusKm, density)).toBeLessThan(0.03);
			// The bbox corners lie farther than the target.
			expect(fogAt(radiusKm * 1.3, density)).toBeLessThan(0.05);
		}
	});

	it("thins out smoothly as the camera moves away", () => {
		let previous = FOG_DENSITY_PER_KM;
		for (let viewKm = 10; viewKm <= 8000; viewKm *= 1.25) {
			const density = fogDensityAt(viewKm);
			expect(density).toBeLessThanOrEqual(previous);
			expect(previous - density).toBeLessThan(FOG_DENSITY_PER_KM * 0.25);
			previous = density;
		}
	});
});
