import {
	MAX_VEHICLE_AXLE_COUNT,
	MIN_VEHICLE_AXLE_COUNT,
} from "@hack-the-andes-project/business/constants";
import { ROUTE_REVIEW_PLACE_IDS } from "@hack-the-andes-project/business/route-review/places";
import {
	routeCandidateSchema as businessRouteCandidateSchema,
	routeReviewSchema as businessRouteReviewSchema,
	routeSignalSchema as businessRouteSignalSchema,
	plannedTripSummarySchema,
	routeRecommendationSchema,
	routeRiskAssessmentSchema,
	routeSegmentSchema,
} from "@hack-the-andes-project/business/route-review/schemas";
import { VEHICLE_TYPE_IDS } from "@hack-the-andes-project/business/route-review/vehicle-types";
import { VEHICLE_PLATE_LENGTH_CHARS } from "@hack-the-andes-project/db/schema/constants";
import type { Geometry } from "geojson";
import { z } from "zod";

import {
	MIN_FLEET_TEXT_LENGTH_CHARS,
	SAME_ORIGIN_AND_DESTINATION_MESSAGE,
} from "./constants";
import {
	fleetIdSchema,
	fleetNameSchema,
	vehicleSummarySchema,
} from "./schemas";

const signalGeometrySchema: z.ZodType<Geometry> =
	businessRouteSignalSchema.shape.geometry.unwrap();
export const routeSignalSchema = businessRouteSignalSchema.extend({
	geometry: signalGeometrySchema.nullable(),
});
export const routeCandidateSchema = businessRouteCandidateSchema.extend({
	signals: z.array(routeSignalSchema),
});
export const routeReviewSchema = businessRouteReviewSchema.extend({
	candidates: z.array(routeCandidateSchema),
});
export {
	plannedTripSummarySchema,
	routeRecommendationSchema,
	routeRiskAssessmentSchema,
	routeSegmentSchema,
};

const placeIdSchema = z.enum(ROUTE_REVIEW_PLACE_IDS);

export const routeReviewInputSchema = z
	.object({
		originPlaceId: placeIdSchema,
		destinationPlaceId: placeIdSchema,
		vehicleId: fleetIdSchema,
		departureAt: z.date(),
	})
	.refine((input) => input.originPlaceId !== input.destinationPlaceId, {
		message: SAME_ORIGIN_AND_DESTINATION_MESSAGE,
	});

export const vehicleProfileSchema = z.object({
	vehicleTypeId: z.enum(VEHICLE_TYPE_IDS),
	axleCount: z
		.number()
		.int()
		.min(MIN_VEHICLE_AXLE_COUNT)
		.max(MAX_VEHICLE_AXLE_COUNT),
	grossWeightKg: z.number().positive().nullable(),
});

export const vehicleCreateInputSchema = vehicleProfileSchema.extend({
	name: fleetNameSchema,
	plate: z
		.string()
		.min(MIN_FLEET_TEXT_LENGTH_CHARS)
		.max(VEHICLE_PLATE_LENGTH_CHARS)
		.nullable(),
});

export const vehicleProfileUpdateInputSchema = vehicleProfileSchema.extend({
	id: fleetIdSchema,
});

export const profiledVehicleSummarySchema = vehicleSummarySchema.extend({
	connectionId: z.string().nullable(),
	externalId: z.string().nullable(),
	profile: vehicleProfileSchema.nullable(),
});

export const tripPlanInputSchema = z.object({
	reviewId: fleetIdSchema,
	candidateId: z.string(),
	name: fleetNameSchema,
});

export const tripCandidateChoiceInputSchema = z.object({
	id: fleetIdSchema,
	candidateId: z.string(),
});

export const plannedTripSchema = plannedTripSummarySchema.extend({
	review: routeReviewSchema,
});

export interface RouteRiskAssessment
	extends z.infer<typeof routeRiskAssessmentSchema> {}
export interface RouteReviewSignal extends z.infer<typeof routeSignalSchema> {}
export interface RouteReviewSegment
	extends z.infer<typeof routeSegmentSchema> {}
export interface RouteReviewCandidate
	extends z.infer<typeof routeCandidateSchema> {}
export interface RouteReviewInput
	extends z.infer<typeof routeReviewInputSchema> {}
export interface RouteReview extends z.infer<typeof routeReviewSchema> {}
export interface VehicleProfile extends z.infer<typeof vehicleProfileSchema> {}
export interface VehicleCreateInput
	extends z.infer<typeof vehicleCreateInputSchema> {}
export interface VehicleProfileUpdateInput
	extends z.infer<typeof vehicleProfileUpdateInputSchema> {}
export interface ProfiledVehicleSummary
	extends z.infer<typeof profiledVehicleSummarySchema> {}
export interface TripPlanInput extends z.infer<typeof tripPlanInputSchema> {}
export interface TripCandidateChoiceInput
	extends z.infer<typeof tripCandidateChoiceInputSchema> {}
export interface PlannedTripSummary
	extends z.infer<typeof plannedTripSummarySchema> {}
export interface PlannedTrip extends z.infer<typeof plannedTripSchema> {}
