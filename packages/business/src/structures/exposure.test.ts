import { destination } from "@turf/destination";
import { describe, expect, it } from "vitest";
import { STRUCTURE_EXPOSURE_RADIUS_M } from "./constants";
import {
	type ExposureIncident,
	structureExposure,
	structureExposureBounds,
} from "./exposure";

const anchor = { lat: -11.84, lng: -76.39 };

describe("structure exposure", () => {
	it("bounds match the radius in all cardinal directions", () => {
		const bounds = structureExposureBounds(anchor);
		const cardinalBounds = [
			{ bearing: 0, bound: bounds.north, coordinateIndex: 1 },
			{ bearing: 90, bound: bounds.east, coordinateIndex: 0 },
			{ bearing: 180, bound: bounds.south, coordinateIndex: 1 },
			{ bearing: 270, bound: bounds.west, coordinateIndex: 0 },
		];
		for (const { bearing, bound, coordinateIndex } of cardinalBounds) {
			const cardinalPoint = destination(
				[anchor.lng, anchor.lat],
				STRUCTURE_EXPOSURE_RADIUS_M,
				bearing,
				{ units: "meters" },
			).geometry.coordinates;
			const coordinate = cardinalPoint[coordinateIndex];
			if (coordinate === undefined)
				throw new Error("Missing cardinal coordinate");
			expect(bound).toBeCloseTo(coordinate, 10);
		}
	});

	it("excludes distant, expired and unlocated incidents and orders by severity then distance", () => {
		const incidents: ExposureIncident[] = [
			{ id: "info", ...anchor, severity: "info" },
			{
				id: "far-critical",
				lat: anchor.lat + 0.02,
				lng: anchor.lng,
				severity: "critical",
			},
			{ id: "near-critical", ...anchor, severity: "critical" },
			{ id: "outside", lat: -12.5, lng: anchor.lng, severity: "critical" },
			{ id: "missing", lat: null, lng: null, severity: "critical" },
			{
				id: "expired",
				...anchor,
				severity: "critical",
				validUntil: new Date("2020-01-01"),
			},
		];
		expect(
			structureExposure(anchor, incidents).map(({ incident }) => incident.id),
		).toEqual(["near-critical", "far-critical", "info"]);
	});
});
