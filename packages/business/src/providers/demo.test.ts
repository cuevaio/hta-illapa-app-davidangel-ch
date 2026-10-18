import { distance } from "@turf/distance";
import { describe, expect, it } from "vitest";

import { KMH_TO_MPS, MS_PER_SECOND } from "../constants";
import { projectOntoRoute } from "../hazards/progress";
import {
	CARRETERA_CENTRAL,
	HUANCAYO,
	LIMA,
	LIMA_HUANCAYO_ROUTE,
} from "../hazards/test-fixtures";
import { DEMO_TIME_ACCELERATION_FACTOR, DEMO_VEHICLES } from "./constants";
import { type DemoTrip, demoProvider, simulateDemoPositions } from "./demo";

const now = new Date("2026-10-17T12:00:00Z");
const [callaoTruck] = DEMO_VEHICLES;
const limaToHuancayo: DemoTrip = {
	routeGeometry: CARRETERA_CENTRAL,
	routeDistanceM: LIMA_HUANCAYO_ROUTE.distanceM,
	routeDurationS: LIMA_HUANCAYO_ROUTE.durationS,
	destinationLat: HUANCAYO[1],
	destinationLng: HUANCAYO[0],
	createdAt: now,
};

function tripStartedSecondsAgo(elapsedS: number): DemoTrip {
	return {
		...limaToHuancayo,
		createdAt: new Date(now.getTime() - elapsedS * MS_PER_SECOND),
	};
}

describe("simulateDemoPositions", () => {
	it("parks an idle truck at its depot until it has a position", () => {
		expect(callaoTruck).toBeDefined();
		if (!callaoTruck) return;
		expect(
			simulateDemoPositions(
				[
					{
						externalId: callaoTruck.externalId,
						lastLat: null,
						lastLng: null,
						activeTrip: null,
					},
					{
						externalId: "demo-unknown",
						lastLat: null,
						lastLng: null,
						activeTrip: null,
					},
				],
				now,
			),
		).toEqual([
			{
				externalId: callaoTruck.externalId,
				...callaoTruck.depot,
				speedKmh: 0,
				heading: null,
				recordedAt: now,
			},
		]);
	});

	it("keeps an idle truck where it last stopped", () => {
		expect(
			simulateDemoPositions(
				[
					{
						externalId: "demo-callao",
						lastLat: HUANCAYO[1],
						lastLng: HUANCAYO[0],
						activeTrip: null,
					},
				],
				now,
			),
		).toMatchObject([{ lat: HUANCAYO[1], lng: HUANCAYO[0], speedKmh: 0 }]);
	});

	it("drives the trip route at the accelerated planned pace and reports the planned speed", () => {
		const elapsedS = 600;
		const [position] = simulateDemoPositions(
			[
				{
					externalId: "demo-callao",
					lastLat: LIMA[1],
					lastLng: LIMA[0],
					activeTrip: tripStartedSecondsAgo(elapsedS),
				},
			],
			now,
		);
		expect(position).toBeDefined();
		if (!position) return;
		const plannedSpeedMps =
			LIMA_HUANCAYO_ROUTE.distanceM / LIMA_HUANCAYO_ROUTE.durationS;
		const progress = projectOntoRoute(CARRETERA_CENTRAL, position);
		expect(progress.offRouteM).toBeLessThan(1);
		expect(progress.distanceAlongM).toBeCloseTo(
			plannedSpeedMps * DEMO_TIME_ACCELERATION_FACTOR * elapsedS,
			0,
		);
		expect(position.speedKmh).toBeCloseTo(plannedSpeedMps / KMH_TO_MPS);
		expect(position.heading).toBeGreaterThan(0);
		expect(position.heading).toBeLessThan(90);
		expect(position.recordedAt).toBe(now);
	});

	it("stops at the requested destination once the route is covered", () => {
		const [position] = simulateDemoPositions(
			[
				{
					externalId: "demo-callao",
					lastLat: LIMA[1],
					lastLng: LIMA[0],
					activeTrip: tripStartedSecondsAgo(LIMA_HUANCAYO_ROUTE.durationS),
				},
			],
			now,
		);
		expect(position).toMatchObject({
			lat: HUANCAYO[1],
			lng: HUANCAYO[0],
			speedKmh: 0,
			heading: null,
		});
	});

	it("holds a truck at the route start when its trip was created after the run began", () => {
		const [position] = simulateDemoPositions(
			[
				{
					externalId: "demo-callao",
					lastLat: LIMA[1],
					lastLng: LIMA[0],
					activeTrip: tripStartedSecondsAgo(-60),
				},
			],
			now,
		);
		expect(position).toBeDefined();
		if (!position) return;
		expect(
			distance(LIMA, [position.lng, position.lat], { units: "meters" }),
		).toBeLessThan(1);
	});
});

describe("demoProvider", () => {
	it("lists the demo fleet and reports every truck at its depot", async () => {
		const vehicles = await demoProvider.listVehicles({});
		expect(
			vehicles.map(({ externalId, name, plate }) => ({
				externalId,
				name,
				plate,
			})),
		).toEqual(
			DEMO_VEHICLES.map(({ externalId, name, plate }) => ({
				externalId,
				name,
				plate,
			})),
		);
		expect(
			vehicles.map(({ vehicleTypeId, axleCount, grossWeightKg }) => ({
				vehicleTypeId,
				axleCount,
				grossWeightKg,
			})),
		).toEqual([
			{ vehicleTypeId: "t2s3", axleCount: 5, grossWeightKg: 43_000 },
			{ vehicleTypeId: "t3s3", axleCount: 6, grossWeightKg: 48_000 },
			{ vehicleTypeId: "t2s3", axleCount: 5, grossWeightKg: 43_000 },
			{ vehicleTypeId: "t3s3", axleCount: 6, grossWeightKg: 48_000 },
			{ vehicleTypeId: "t2s3", axleCount: 5, grossWeightKg: 43_000 },
			{ vehicleTypeId: "t3s3", axleCount: 6, grossWeightKg: 48_000 },
		]);

		const positions = await demoProvider.fetchLatestPositions({});
		expect(positions).toHaveLength(DEMO_VEHICLES.length);
		expect(positions.map(({ lat, lng }) => ({ lat, lng }))).toEqual(
			DEMO_VEHICLES.map(({ depot }) => depot),
		);
	});
});
