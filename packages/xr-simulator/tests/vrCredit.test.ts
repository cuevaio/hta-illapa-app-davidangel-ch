import { describe, expect, it } from "vitest";
import type { Bounds, Vec3 } from "../src/map/flight";
import {
	CREDIT_FLIGHT_DISTANCE_M,
	CREDIT_FLIGHT_PITCH_RAD,
	CREDIT_TABLE_MARGIN_M,
} from "../src/xr/constants";
import {
	creditOutOfView,
	flightCreditPose,
	tableCreditPose,
	vrCreditContent,
} from "../src/xr/credit";
import { tableScale } from "../src/xr/mapTable";

const IMAGERY = { text: "Imagen: Esri World Imagery", notice: null };
const PROTOTYPE = {
	text: "Imagen: Esri World Imagery",
	notice: "Modo prototipo (sin clave)",
};
const WEATHER = "Datos meteorológicos: Nubes: NOAA GOES-19";

describe("vrCreditContent (S16): what the map credit says", () => {
	it("shows nothing when neither imagery nor weather layers are visible", () => {
		expect(vrCreditContent(null, null)).toBeNull();
	});

	it("credits the imagery while Satélite is on, and the weather while a layer is on", () => {
		expect(vrCreditContent(IMAGERY, null)).toEqual({
			text: "Imagen: Esri World Imagery",
			notice: false,
		});
		expect(vrCreditContent(null, WEATHER)).toEqual({
			text: WEATHER,
			notice: false,
		});
		expect(vrCreditContent(IMAGERY, WEATHER)?.text).toBe(
			`Imagen: Esri World Imagery\n${WEATHER}`,
		);
	});

	it("keeps the keyless prototype notice, compact on the imagery line", () => {
		expect(vrCreditContent(PROTOTYPE, null)).toEqual({
			text: "Imagen: Esri World Imagery · Modo prototipo (sin clave)",
			notice: true,
		});
	});
});

const BOUNDS: Bounds = { minX: -600, maxX: 600, minZ: -900, maxZ: 900 };
const fitted = tableScale(BOUNDS);
const POSE = { center: [0.2, 0.9, 0.75] satisfies Vec3, yaw: 0, scale: fitted };

describe("tableCreditPose: on the near (south) edge of the maquette", () => {
	it("sits just past the south edge, toward the user, tilted up", () => {
		const credit = tableCreditPose(BOUNDS, POSE);
		const halfDepth = 900 * fitted;
		expect(credit.position[0]).toBeCloseTo(0.2, 9);
		expect(credit.position[2]).toBeCloseTo(
			0.75 - halfDepth - CREDIT_TABLE_MARGIN_M,
			9,
		);
		expect(credit.position[1]).toBeGreaterThanOrEqual(0.9);
		expect(credit.tilt).toBeGreaterThan(0);
		expect(credit.tilt).toBeLessThan(Math.PI / 2);
	});

	it("moves, turns and scales with the table", () => {
		const turned = tableCreditPose(BOUNDS, {
			...POSE,
			center: [1, 0.9, 0],
			yaw: Math.PI / 2,
			scale: fitted * 2,
		});
		expect(turned.yaw).toBeCloseTo(Math.PI / 2, 9);
		expect(turned.position[0]).toBeCloseTo(
			1 - 900 * fitted * 2 - CREDIT_TABLE_MARGIN_M,
			9,
		);
		expect(turned.position[2]).toBeCloseTo(0, 9);
		expect(turned.scale).toBeCloseTo(2, 9);
		expect(tableCreditPose(BOUNDS, POSE).scale).toBeCloseTo(1, 9);
	});
});

describe("flightCreditPose / creditOutOfView: low in the view, world-stable", () => {
	const head: Vec3 = [5, 3, -2];
	const angleFromGaze = (p: Vec3, gaze: Vec3) => {
		const d: Vec3 = [p[0] - head[0], p[1] - head[1], p[2] - head[2]];
		const dot = d[0] * gaze[0] + d[1] * gaze[1] + d[2] * gaze[2];
		return Math.acos(dot / (Math.hypot(...d) * Math.hypot(...gaze)));
	};

	it("spawns below the gaze, outside the central 30° cone, at its distance", () => {
		const gaze: Vec3 = [0, 0, 1];
		const credit = flightCreditPose(head, gaze);
		const d: Vec3 = [
			credit.position[0] - head[0],
			credit.position[1] - head[1],
			credit.position[2] - head[2],
		];
		expect(Math.hypot(...d)).toBeCloseTo(CREDIT_FLIGHT_DISTANCE_M, 9);
		expect(credit.position[1]).toBeLessThan(head[1]);
		expect(angleFromGaze(credit.position, gaze)).toBeGreaterThan(
			(15 * Math.PI) / 180,
		);
		expect(angleFromGaze(credit.position, gaze)).toBeCloseTo(
			CREDIT_FLIGHT_PITCH_RAD,
			9,
		);
	});

	it("is measured from the gaze heading, so looking down does not push it under the floor", () => {
		const down = flightCreditPose(head, [0, -0.7, 0.7]);
		expect(down.position[1]).toBeCloseTo(
			flightCreditPose(head, [0, 0, 1]).position[1],
			9,
		);
	});

	it("stays put while still in view and moves only once it leaves it", () => {
		const credit = flightCreditPose(head, [0, 0, 1]);
		expect(creditOutOfView(head, [0.2, -0.1, 1], credit.position)).toBe(false);
		expect(creditOutOfView(head, [1, 0, 0], credit.position)).toBe(true);
		expect(creditOutOfView([5, 3, 40], [0, 0, 1], credit.position)).toBe(true);
	});
});
