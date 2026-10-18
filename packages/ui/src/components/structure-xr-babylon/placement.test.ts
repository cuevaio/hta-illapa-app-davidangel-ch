import { describe, expect, it } from "vitest";
import {
	MAQUETA_SCALE_RATIO,
	MAQUETA_SIZE_M,
	PLACEMENT_FALLBACK_DISTANCE_M,
	PLACEMENT_FALLBACK_HEIGHT_M,
} from "./constants";
import { getFallbackTablePosition, getMaquetaOffset } from "./placement";

describe("maqueta placement", () => {
	it("puts the focus terrain elevation exactly at the table point", () => {
		const focus = { x: 1234, z: -5678 };
		const elevationM = 2460;
		const table = { x: 0.4, y: 0.75, z: -1.2 };
		const offset = getMaquetaOffset(focus, elevationM);
		expect(table.x + offset.x + focus.x * MAQUETA_SCALE_RATIO).toBeCloseTo(
			table.x,
		);
		expect(table.y + offset.y + elevationM * MAQUETA_SCALE_RATIO).toBeCloseTo(
			table.y,
		);
		expect(table.z + offset.z + focus.z * MAQUETA_SCALE_RATIO).toBeCloseTo(
			table.z,
		);
	});

	it("turns the clipped kilometre into a one metre table model", () => {
		expect(MAQUETA_SIZE_M * MAQUETA_SCALE_RATIO).toBe(1);
		const offset = getMaquetaOffset({ x: 0, z: 0 }, 0);
		expect(offset.x).toBeCloseTo(0);
		expect(offset.y).toBeCloseTo(0);
		expect(offset.z).toBeCloseTo(0);
	});
});

describe("fallback table placement", () => {
	it("uses right handed north (-z) and floor-relative table height", () => {
		const position = getFallbackTablePosition(
			{ x: 4, y: 1.7, z: 6 },
			{ x: 0, y: 0, z: -1 },
		);
		expect(position).toEqual({
			x: 4,
			y: PLACEMENT_FALLBACK_HEIGHT_M,
			z: 6 - PLACEMENT_FALLBACK_DISTANCE_M,
		});
	});

	it("ignores viewer pitch while preserving the full horizontal distance", () => {
		const position = getFallbackTablePosition(
			{ x: 0, y: 1.7, z: 0 },
			{ x: 3, y: -8, z: -4 },
		);
		expect(Math.hypot(position.x, position.z)).toBeCloseTo(
			PLACEMENT_FALLBACK_DISTANCE_M,
		);
		expect(position.x).toBeGreaterThan(0);
		expect(position.z).toBeLessThan(0);
		expect(position.y).toBe(PLACEMENT_FALLBACK_HEIGHT_M);
	});

	it("stays finite when looking straight up or down", () => {
		const position = getFallbackTablePosition(
			{ x: 0, y: 1.7, z: 0 },
			{ x: 0, y: -1, z: 0 },
		);
		expect(position).toEqual({
			x: 0,
			y: PLACEMENT_FALLBACK_HEIGHT_M,
			z: -PLACEMENT_FALLBACK_DISTANCE_M,
		});
	});
});
