import type { Database } from "@hack-the-andes-project/db";
import {
	routeReview,
	trip,
	vehicle,
} from "@hack-the-andes-project/db/schema/fleet";
import { and, eq, isNotNull, lt, notExists } from "drizzle-orm";
import type { RequestLogger } from "evlog";
import { MS_PER_SECOND, ROUTE_REVIEW_RETENTION_MS } from "../constants";
import { evaluateRouteReview } from "../route-review/evaluate";
import {
	ROUTE_REVIEW_PLACES,
	type RouteReviewPlaceId,
} from "../route-review/places";
import {
	persistedPlannedTripSummarySchema,
	persistedRouteReviewSchema,
	routeCandidateSummarySchema,
	type StoredRouteReview,
} from "../route-review/schemas";
import { VEHICLE_TYPE_IDS } from "../route-review/vehicle-types";
import {
	ROUTE_CANDIDATE_INELIGIBLE_MESSAGE,
	ROUTE_CANDIDATE_NOT_FOUND_MESSAGE,
	ROUTE_REVIEW_NOT_FOUND_MESSAGE,
	TRIP_NOT_EDITABLE_MESSAGE,
	TRIP_NOT_FOUND_MESSAGE,
	TRIP_NOT_PLANNED_MESSAGE,
	VEHICLE_GPS_REQUIRED_MESSAGE,
	VEHICLE_NOT_FOUND_MESSAGE,
	VEHICLE_PROFILE_REQUIRED_MESSAGE,
	VEHICLE_TRIP_ALREADY_ACTIVE_MESSAGE,
} from "./constants";

export class FleetPlanningError extends Error {
	constructor(
		public readonly code: "NOT_FOUND" | "BAD_REQUEST",
		message: string,
	) {
		super(message);
	}
}

export interface ReviewTripContext {
	db: Database;
	organizationId: string;
	osrmBaseUrl: string;
	log: RequestLogger;
}

export interface VehicleReviewInput {
	vehicleId: string;
	originPlaceId: RouteReviewPlaceId;
	destinationPlaceId: RouteReviewPlaceId;
	departureAt: Date;
}

export function vehicleProfile(
	selectedVehicle: Pick<
		typeof vehicle.$inferSelect,
		"vehicleTypeId" | "axleCount" | "grossWeightKg"
	>,
) {
	const vehicleTypeId = VEHICLE_TYPE_IDS.find(
		(identifier) => identifier === selectedVehicle.vehicleTypeId,
	);
	return vehicleTypeId && selectedVehicle.axleCount !== null
		? {
				vehicleTypeId,
				axleCount: selectedVehicle.axleCount,
				grossWeightKg: selectedVehicle.grossWeightKg,
			}
		: null;
}

export async function loadFleetVehicle(
	context: ReviewTripContext,
	vehicleId: string,
) {
	const selectedVehicle = await context.db.query.vehicle.findFirst({
		where: { id: vehicleId, organizationId: context.organizationId },
	});
	if (!selectedVehicle)
		throw new FleetPlanningError("NOT_FOUND", VEHICLE_NOT_FOUND_MESSAGE);
	return selectedVehicle;
}

export async function evaluateVehicleReview(
	context: ReviewTripContext,
	input: VehicleReviewInput,
) {
	const selectedVehicle = await loadFleetVehicle(context, input.vehicleId);
	const profile = vehicleProfile(selectedVehicle);
	if (!profile)
		throw new FleetPlanningError(
			"BAD_REQUEST",
			VEHICLE_PROFILE_REQUIRED_MESSAGE,
		);
	const now = new Date();
	const evaluation = await evaluateRouteReview({
		db: context.db,
		origin: ROUTE_REVIEW_PLACES[input.originPlaceId],
		destination: ROUTE_REVIEW_PLACES[input.destinationPlaceId],
		departureAt: input.departureAt,
		axleCount: profile.axleCount,
		osrmBaseUrl: context.osrmBaseUrl,
		now,
		log: context.log,
	});
	const review: StoredRouteReview = {
		...input,
		...evaluation,
		id: crypto.randomUUID(),
		vehicleAxleCount: profile.axleCount,
		evaluatedAt: now,
	};
	await context.db.insert(routeReview).values({
		id: review.id,
		organizationId: context.organizationId,
		vehicleId: input.vehicleId,
		originPlaceId: input.originPlaceId,
		destinationPlaceId: input.destinationPlaceId,
		departureAt: input.departureAt,
		review,
		evaluatedAt: now,
		createdAt: now,
	});
	const [deletedReviews] = await context.db
		.delete(routeReview)
		.where(
			and(
				eq(routeReview.organizationId, context.organizationId),
				lt(
					routeReview.createdAt,
					new Date(now.getTime() - ROUTE_REVIEW_RETENTION_MS),
				),
				notExists(
					context.db
						.select({ id: trip.id })
						.from(trip)
						.where(eq(trip.reviewId, routeReview.id)),
				),
			),
		);

	context.log.set({
		routeReview: {
			id: review.id,
			reviewsPruned: deletedReviews.affectedRows,
			organizationId: context.organizationId,
			vehicleId: input.vehicleId,
			candidates: review.candidates.length,
			recommendedCandidateId: review.recommendedCandidateId,
		},
	});
	return review;
}

export async function loadReview(context: ReviewTripContext, reviewId: string) {
	const stored = await context.db.query.routeReview.findFirst({
		where: { id: reviewId, organizationId: context.organizationId },
	});
	if (!stored)
		throw new FleetPlanningError("NOT_FOUND", ROUTE_REVIEW_NOT_FOUND_MESSAGE);
	return persistedRouteReviewSchema.parse(stored.review);
}

export function requireEligibleCandidate(
	review: StoredRouteReview,
	candidateId: string,
) {
	const candidate = review.candidates.find(({ id }) => id === candidateId);
	if (!candidate)
		throw new FleetPlanningError(
			"BAD_REQUEST",
			ROUTE_CANDIDATE_NOT_FOUND_MESSAGE,
		);
	if (!candidate.eligibility.eligible)
		throw new FleetPlanningError(
			"BAD_REQUEST",
			ROUTE_CANDIDATE_INELIGIBLE_MESSAGE,
		);
	return candidate;
}

export function plannedRouteColumns(
	review: StoredRouteReview,
	candidate: StoredRouteReview["candidates"][number],
) {
	const origin = ROUTE_REVIEW_PLACES[review.originPlaceId];
	const destination = ROUTE_REVIEW_PLACES[review.destinationPlaceId];
	return {
		reviewId: review.id,
		chosenCandidateId: candidate.id,
		chosenCandidate: routeCandidateSummarySchema.parse(candidate),
		originPlaceId: review.originPlaceId,
		destinationPlaceId: review.destinationPlaceId,
		departureAt: review.departureAt,
		originLat: origin.lat,
		originLng: origin.lng,
		destinationLat: destination.lat,
		destinationLng: destination.lng,
		destinationName: destination.name,
		routeGeometry: candidate.geometry,
		routeDistanceM: candidate.distanceM,
		routeDurationS: candidate.durationS,
		lastEvaluatedAt: review.evaluatedAt,
	};
}

export function reevaluatedCandidate(
	review: StoredRouteReview,
	previousCandidateId: string,
) {
	return (
		review.candidates.find(({ id }) => id === previousCandidateId) ??
		review.candidates.find(({ id }) => id === review.recommendedCandidateId) ??
		null
	);
}

export function summarizeReviewTrip(
	storedTrip: typeof trip.$inferSelect,
	vehicleName: string | null,
) {
	return persistedPlannedTripSummarySchema.parse({
		...storedTrip,
		vehicleName,
	});
}

export async function loadReviewTrip(
	context: ReviewTripContext,
	tripId: string,
) {
	const storedTrip = await context.db.query.trip.findFirst({
		where: { id: tripId, organizationId: context.organizationId },
	});
	if (!storedTrip)
		throw new FleetPlanningError("NOT_FOUND", TRIP_NOT_FOUND_MESSAGE);
	if (!storedTrip.reviewId)
		throw new FleetPlanningError("NOT_FOUND", ROUTE_REVIEW_NOT_FOUND_MESSAGE);
	const review = await loadReview(context, storedTrip.reviewId);
	const selectedVehicle = await loadFleetVehicle(context, storedTrip.vehicleId);
	return { storedTrip, review, selectedVehicle };
}

export async function getReviewTrip(
	context: ReviewTripContext,
	tripId: string,
) {
	const { storedTrip, review, selectedVehicle } = await loadReviewTrip(
		context,
		tripId,
	);
	return {
		...summarizeReviewTrip(storedTrip, selectedVehicle.name),
		review,
	};
}

export async function listReviewTrips(context: ReviewTripContext) {
	const rows = await context.db

		.select({
			id: trip.id,
			vehicleId: trip.vehicleId,
			vehicleName: vehicle.name,
			name: trip.name,
			originPlaceId: trip.originPlaceId,
			destinationPlaceId: trip.destinationPlaceId,
			departureAt: trip.departureAt,
			status: trip.status,
			chosenCandidate: trip.chosenCandidate,
			lastEvaluatedAt: trip.lastEvaluatedAt,
			createdAt: trip.createdAt,
		})
		.from(trip)
		.leftJoin(
			vehicle,
			and(
				eq(vehicle.id, trip.vehicleId),
				eq(vehicle.organizationId, context.organizationId),
			),
		)
		.where(
			and(
				eq(trip.organizationId, context.organizationId),
				isNotNull(trip.reviewId),
			),
		)
		.orderBy(trip.departureAt, trip.id);
	context.log.set({ fleet: { plannedTripsListed: rows.length } });
	return rows.map((row) => persistedPlannedTripSummarySchema.parse(row));
}

export async function planReviewTrip(
	context: ReviewTripContext,
	input: { reviewId: string; candidateId: string; name: string },
) {
	const review = await loadReview(context, input.reviewId);
	const selectedVehicle = await loadFleetVehicle(context, review.vehicleId);
	const now = new Date();
	const storedTrip: typeof trip.$inferSelect = {
		...plannedRouteColumns(
			review,
			requireEligibleCandidate(review, input.candidateId),
		),
		id: crypto.randomUUID(),
		organizationId: context.organizationId,
		vehicleId: review.vehicleId,
		name: input.name,
		status: "planned",
		etaAt: null,
		startedAt: null,
		createdAt: now,
		updatedAt: now,
	};
	await context.db.insert(trip).values(storedTrip);
	context.log.set({
		fleet: {
			tripId: storedTrip.id,
			status: storedTrip.status,
			reviewId: review.id,
		},
	});
	return summarizeReviewTrip(storedTrip, selectedVehicle.name);
}

export async function chooseReviewTripCandidate(
	context: ReviewTripContext,
	input: { id: string; candidateId: string },
) {
	const { storedTrip, review } = await loadReviewTrip(context, input.id);
	if (storedTrip.status !== "planned")
		throw new FleetPlanningError("BAD_REQUEST", TRIP_NOT_EDITABLE_MESSAGE);
	const [updated] = await context.db
		.update(trip)
		.set(
			plannedRouteColumns(
				review,
				requireEligibleCandidate(review, input.candidateId),
			),
		)
		.where(
			and(
				eq(trip.id, input.id),
				eq(trip.organizationId, context.organizationId),
				eq(trip.status, "planned"),
			),
		);
	if (!updated.affectedRows)
		throw new FleetPlanningError("BAD_REQUEST", TRIP_NOT_EDITABLE_MESSAGE);
	context.log.set({
		fleet: { tripId: input.id, chosenCandidateId: input.candidateId },
	});
	return getReviewTrip(context, input.id);
}

export async function reevaluateReviewTrip(
	context: ReviewTripContext,
	tripId: string,
) {
	const { storedTrip, review } = await loadReviewTrip(context, tripId);
	if (storedTrip.status !== "planned")
		throw new FleetPlanningError("BAD_REQUEST", TRIP_NOT_EDITABLE_MESSAGE);
	const updatedReview = await evaluateVehicleReview(context, {
		vehicleId: storedTrip.vehicleId,
		originPlaceId: review.originPlaceId,
		destinationPlaceId: review.destinationPlaceId,
		departureAt: review.departureAt,
	});
	const candidate = reevaluatedCandidate(
		updatedReview,
		storedTrip.chosenCandidateId ?? "",
	);
	const previousCandidate = review.candidates.find(
		({ id }) => id === storedTrip.chosenCandidateId,
	);
	// With no replacement, retain the selected route as ineligible so the plan stays inspectable but cannot start.
	if (!candidate && previousCandidate)
		updatedReview.candidates.push({
			...previousCandidate,
			eligibility: { ...previousCandidate.eligibility, eligible: false },
		});
	const chosenCandidate =
		candidate ??
		updatedReview.candidates.find(
			({ id }) => id === storedTrip.chosenCandidateId,
		);
	if (!chosenCandidate)
		throw new FleetPlanningError(
			"NOT_FOUND",
			ROUTE_CANDIDATE_NOT_FOUND_MESSAGE,
		);
	if (!candidate)
		await context.db
			.update(routeReview)
			.set({ review: updatedReview })
			.where(
				and(
					eq(routeReview.id, updatedReview.id),
					eq(routeReview.organizationId, context.organizationId),
				),
			);
	const [updated] = await context.db
		.update(trip)
		.set(plannedRouteColumns(updatedReview, chosenCandidate))
		.where(
			and(
				eq(trip.id, tripId),
				eq(trip.organizationId, context.organizationId),
				eq(trip.status, "planned"),
			),
		);
	if (!updated.affectedRows)
		throw new FleetPlanningError("BAD_REQUEST", TRIP_NOT_EDITABLE_MESSAGE);
	context.log.set({
		fleet: {
			tripId,
			previousCandidateId: storedTrip.chosenCandidateId,
			chosenCandidateId: chosenCandidate.id,
			candidateFallback: candidate?.id !== storedTrip.chosenCandidateId,
			noRecommendedCandidate: updatedReview.recommendedCandidateId === null,
		},
	});
	return getReviewTrip(context, tripId);
}

export function validateTripStart(
	storedTrip: Pick<typeof trip.$inferSelect, "status">,
	selectedVehicle: Pick<typeof vehicle.$inferSelect, "connectionId">,
	hasActiveTrip: boolean,
) {
	if (storedTrip.status !== "planned")
		throw new FleetPlanningError("BAD_REQUEST", TRIP_NOT_PLANNED_MESSAGE);
	if (!selectedVehicle.connectionId)
		throw new FleetPlanningError("BAD_REQUEST", VEHICLE_GPS_REQUIRED_MESSAGE);
	if (hasActiveTrip)
		throw new FleetPlanningError(
			"BAD_REQUEST",
			VEHICLE_TRIP_ALREADY_ACTIVE_MESSAGE,
		);
}

export async function startReviewTrip(
	context: ReviewTripContext,
	tripId: string,
) {
	const { storedTrip, review, selectedVehicle } = await loadReviewTrip(
		context,
		tripId,
	);
	const activeTrip = await context.db.query.trip.findFirst({
		columns: { id: true },
		where: {
			organizationId: context.organizationId,
			vehicleId: storedTrip.vehicleId,
			status: "active",
		},
	});
	validateTripStart(storedTrip, selectedVehicle, Boolean(activeTrip));
	const candidate = requireEligibleCandidate(
		review,
		storedTrip.chosenCandidateId ?? "",
	);
	const now = new Date();
	const [updated] = await context.db
		.update(trip)
		.set({
			status: "active",
			startedAt: now,
			etaAt: new Date(now.getTime() + candidate.durationS * MS_PER_SECOND),
		})
		.where(
			and(
				eq(trip.id, tripId),
				eq(trip.organizationId, context.organizationId),
				eq(trip.status, "planned"),
			),
		);
	if (!updated.affectedRows)
		throw new FleetPlanningError("BAD_REQUEST", TRIP_NOT_PLANNED_MESSAGE);
	context.log.set({ fleet: { tripId, status: "active", startedAt: now } });
	return getReviewTrip(context, tripId);
}
