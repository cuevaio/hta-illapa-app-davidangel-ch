import type { Database } from "@hack-the-andes-project/db";
import { trip } from "@hack-the-andes-project/db/schema/fleet";
import { and, eq, sql } from "drizzle-orm";

import { MS_PER_SECOND } from "../constants";
import type { LatLng, RouteCandidate } from "../hazards/types";
import { resolveObsoleteAlerts } from "./resolve-obsolete-alerts";

export interface CreateFleetTripInput {
	db: Database;
	organizationId: string;
	vehicleId: string;
	name: string;
	origin: LatLng;
	destination: LatLng;
	destinationName?: string;
	route: RouteCandidate;
	tripId?: string;
	preserveExisting?: boolean;
}

export async function createFleetTrip({
	db,
	organizationId,
	vehicleId,
	name,
	origin,
	destination,
	destinationName,
	route,
	tripId = crypto.randomUUID(),
	preserveExisting,
}: CreateFleetTripInput) {
	const createdAt = new Date();
	const createdTrip: typeof trip.$inferSelect = {
		id: tripId,
		organizationId,
		vehicleId,
		name,
		originLat: origin.lat,
		originLng: origin.lng,
		destinationLat: destination.lat,
		destinationLng: destination.lng,
		destinationName:
			destinationName ?? `${destination.lat}, ${destination.lng}`,
		routeGeometry: route.geometry,
		routeDistanceM: route.distanceM,
		routeDurationS: route.durationS,
		status: "active",
		reviewId: null,
		chosenCandidateId: null,
		chosenCandidate: null,
		originPlaceId: null,
		destinationPlaceId: null,
		departureAt: null,
		startedAt: createdAt,
		etaAt: new Date(createdAt.getTime() + route.durationS * MS_PER_SECOND),
		lastEvaluatedAt: null,
		createdAt,
		updatedAt: createdAt,
	};
	let tripsCancelled = 0;
	if (preserveExisting) {
		await db
			.insert(trip)
			.values(createdTrip)
			.onDuplicateKeyUpdate({ set: { id: sql`${trip.id}` } });
	} else {
		const [cancelledTrips] = await db
			.update(trip)
			.set({ status: "cancelled" })
			.where(
				and(
					eq(trip.vehicleId, vehicleId),
					eq(trip.organizationId, organizationId),
					eq(trip.status, "active"),
				),
			);
		tripsCancelled = cancelledTrips.affectedRows;
		await db.insert(trip).values(createdTrip);
	}
	await resolveObsoleteAlerts({ db, organizationId, now: createdAt });
	return { createdTrip, tripsCancelled };
}
