import { along } from "@turf/along";
import { bearing } from "@turf/bearing";
import { length } from "@turf/length";
import type { LineString } from "geojson";
import { z } from "zod";

import { KMH_TO_MPS, MS_PER_SECOND } from "../constants";
import {
	DEMO_HEADING_LOOKAHEAD_M,
	DEMO_TIME_ACCELERATION_FACTOR,
	DEMO_VEHICLES,
	FULL_TURN_DEG,
} from "./constants";
import type { GpsProvider, ProviderPosition } from "./types";

export const demoCredentialsSchema = z.object({});

export type DemoCredentials = z.infer<typeof demoCredentialsSchema>;

export interface DemoTrip {
	routeGeometry: LineString;
	routeDistanceM: number;
	routeDurationS: number;
	destinationLat: number;
	destinationLng: number;
	createdAt: Date;
}

export interface DemoFleetVehicle {
	externalId: string | null;
	lastLat: number | null;
	lastLng: number | null;
	activeTrip: DemoTrip | null;
}

export function simulateDemoPositions(
	fleet: DemoFleetVehicle[],
	now: Date,
): ProviderPosition[] {
	return fleet.flatMap(
		({ externalId, lastLat, lastLng, activeTrip }): ProviderPosition[] => {
			if (externalId === null) return [];
			if (!activeTrip) {
				const parkedAt =
					lastLat !== null && lastLng !== null
						? { lat: lastLat, lng: lastLng }
						: DEMO_VEHICLES.find(
								(demoVehicle) => demoVehicle.externalId === externalId,
							)?.depot;
				return parkedAt
					? [
							{
								externalId,
								...parkedAt,
								speedKmh: 0,
								heading: null,
								recordedAt: now,
							},
						]
					: [];
			}
			const routeSpeedMps =
				activeTrip.routeDurationS > 0
					? activeTrip.routeDistanceM / activeTrip.routeDurationS
					: 0;
			// Trucks cover ground faster than the speed they report, so a trip plays
			// out in minutes while ETAs and alert messages still read as real driving.
			const traveledM =
				(routeSpeedMps *
					DEMO_TIME_ACCELERATION_FACTOR *
					Math.max(0, now.getTime() - activeTrip.createdAt.getTime())) /
				MS_PER_SECOND;
			const routeLengthM = length(
				{ type: "Feature", geometry: activeTrip.routeGeometry, properties: {} },
				{ units: "meters" },
			);
			if (traveledM >= routeLengthM) {
				return [
					{
						externalId,
						lat: activeTrip.destinationLat,
						lng: activeTrip.destinationLng,
						speedKmh: 0,
						heading: null,
						recordedAt: now,
					},
				];
			}
			const current = along(activeTrip.routeGeometry, traveledM, {
				units: "meters",
			});
			const ahead = along(
				activeTrip.routeGeometry,
				traveledM + DEMO_HEADING_LOOKAHEAD_M,
				{ units: "meters" },
			);
			const [lng, lat] = current.geometry.coordinates;
			if (lng === undefined || lat === undefined) return [];
			return [
				{
					externalId,
					lat,
					lng,
					speedKmh: routeSpeedMps / KMH_TO_MPS,
					heading: (bearing(current, ahead) + FULL_TURN_DEG) % FULL_TURN_DEG,
					recordedAt: now,
				},
			];
		},
	);
}

export const demoProvider: GpsProvider<DemoCredentials> = {
	kind: "demo",
	credentialsSchema: demoCredentialsSchema,
	async validateCredentials() {},
	async listVehicles() {
		return DEMO_VEHICLES.map(({ externalId, name, plate }) => ({
			externalId,
			name,
			plate,
		}));
	},
	async fetchLatestPositions() {
		return simulateDemoPositions(
			DEMO_VEHICLES.map(({ externalId }) => ({
				externalId,
				lastLat: null,
				lastLng: null,
				activeTrip: null,
			})),
			new Date(),
		);
	},
};
