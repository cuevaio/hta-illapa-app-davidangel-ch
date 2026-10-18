import type { Database } from "@hack-the-andes-project/db";
import { TEXT_LENGTH_CHARS } from "@hack-the-andes-project/db/schema/constants";
import {
	alert,
	gpsConnection,
	trip,
	vehicle,
	vehiclePosition,
} from "@hack-the-andes-project/db/schema/fleet";
import { and, eq, inArray } from "drizzle-orm";
import type { RequestLogger } from "evlog";

import { DEMO_TRIP_SCENARIOS, FINISHED_TRIP_STATUSES } from "./constants";
import { DEMO_ACCOUNT_EMAIL } from "./demo-account";
import { demoEntityId, ensureDemoConnection } from "./demo-fleet";
import { createFleetTrip } from "./fleet/create-trip";
import { loadAlertableIncidents } from "./fleet/load-alertable-incidents";
import { planDemoTrip } from "./fleet/plan-demo-trip";
import { DEMO_CLEAR_VEHICLE_EXTERNAL_ID } from "./providers/constants";
import { fetchRouteCandidates } from "./routing/osrm";

export interface PrepareDemoInput {
	db: Database;
	organizationId: string;
	encryptionKey: string;
	osrmBaseUrl: string;
	log: RequestLogger;
}

export async function prepareDemo(input: PrepareDemoInput) {
	const { db, organizationId, log } = input;
	const existingConnection = await db.query.gpsConnection.findFirst({
		where: { organizationId, provider: "demo" },
	});
	const connection =
		existingConnection ??
		(await ensureDemoConnection({ ...input, label: "Flota demo" }));
	let vehicles: Array<typeof vehicle.$inferSelect> | undefined;
	for (const scenario of DEMO_TRIP_SCENARIOS) {
		const tripId = await demoEntityId(organizationId, `trip:${scenario}`);
		const existingTrip = await db.query.trip.findFirst({
			where: { id: tripId, organizationId },
		});
		if (existingTrip) continue;
		try {
			vehicles ??= await db.query.vehicle.findMany({
				where: { organizationId, connectionId: connection.id },
				orderBy: { externalId: "asc" },
			});
			const incidents = await loadAlertableIncidents(db);
			for (const selectedVehicle of vehicles) {
				if (
					(scenario === "clear") !==
						(selectedVehicle.externalId === DEMO_CLEAR_VEHICLE_EXTERNAL_ID) ||
					selectedVehicle.lastLat === null ||
					selectedVehicle.lastLng === null
				)
					continue;
				const origin = {
					lat: selectedVehicle.lastLat,
					lng: selectedVehicle.lastLng,
				};
				const plan = await planDemoTrip({
					osrmBaseUrl: input.osrmBaseUrl,
					origin,
					scenario,
					incidents,
				});
				if (!plan) continue;
				const [route] = await fetchRouteCandidates({
					baseUrl: input.osrmBaseUrl,
					origin,
					destination: plan.destination,
				});
				if (!route) continue;
				await createFleetTrip({
					db,
					organizationId,
					vehicleId: selectedVehicle.id,
					tripId,
					preserveExisting: true,
					name:
						scenario === "hazard"
							? "Demo: ruta con peligro"
							: "Demo: ruta despejada",
					origin,
					destination: plan.destination,
					destinationName: plan.incident?.title.slice(0, TEXT_LENGTH_CHARS),
					route,
				});
				break;
			}
		} catch {
			log.set({ demo: { tripPlanningFailed: true, scenario } });
		}
	}
	return {
		vehicleCount: await db.$count(
			vehicle,
			eq(vehicle.organizationId, organizationId),
		),
		tripCount: await db.$count(trip, eq(trip.organizationId, organizationId)),
	};
}

export async function restartFinishedDemo(input: PrepareDemoInput) {
	const { db, organizationId, log } = input;
	const demoTrips = await db.query.trip.findMany({
		columns: { status: true },
		where: { organizationId },
	});
	if (
		demoTrips.length === 0 ||
		demoTrips.some(({ status }) => !FINISHED_TRIP_STATUSES.includes(status))
	)
		return null;
	const finishedTrips = and(
		eq(trip.organizationId, organizationId),
		inArray(trip.status, FINISHED_TRIP_STATUSES),
	);
	// Deleting the finished trips claims the restart: a concurrent restart that
	// passed the same check finds none left and leaves the rebuilt fleet alone.
	// Their alerts go first, as in wipeDemoFleet, so a restart cut short never
	// leaves alerts behind for the reused deterministic trip ids.
	await db
		.delete(alert)
		.where(
			and(
				eq(alert.organizationId, organizationId),
				inArray(
					alert.tripId,
					db.select({ id: trip.id }).from(trip).where(finishedTrips),
				),
			),
		);
	const [claimedTrips] = await db.delete(trip).where(finishedTrips);
	if (claimedTrips.affectedRows === 0) {
		log.set({ demo: { restarted: false, reason: "concurrent_restart" } });
		return null;
	}
	await wipeDemoFleet(db, organizationId);
	const preparedDemo = await prepareDemo(input);
	log.set({
		demo: { restarted: true, reason: "trips_finished", ...preparedDemo },
	});
	return preparedDemo;
}

export async function wipeDemoFleet(db: Database, organizationId: string) {
	await db.delete(alert).where(eq(alert.organizationId, organizationId));
	await db.delete(trip).where(eq(trip.organizationId, organizationId));
	await db
		.delete(vehiclePosition)
		.where(
			inArray(
				vehiclePosition.vehicleId,
				db
					.select({ id: vehicle.id })
					.from(vehicle)
					.where(eq(vehicle.organizationId, organizationId)),
			),
		);
	await db.delete(vehicle).where(eq(vehicle.organizationId, organizationId));
	await db
		.delete(gpsConnection)
		.where(eq(gpsConnection.organizationId, organizationId));
}

export async function findDemoOrganizationId(db: Database) {
	const demoUser = await db.query.user.findFirst({
		where: { email: DEMO_ACCOUNT_EMAIL },
	});
	if (!demoUser) return null;
	const membership = await db.query.member.findFirst({
		where: { userId: demoUser.id, organizationId: demoUser.id },
	});
	return membership?.organizationId ?? null;
}
