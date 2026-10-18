import { TRIP_STATUSES } from "@hack-the-andes-project/db/schema/fleet";
import {
	INCIDENT_CATEGORIES,
	ROAD_STATUSES,
} from "@hack-the-andes-project/db/schema/scraper";
import { z } from "zod";
import { MAX_ROUTE_RISK_SCORE, MIN_ROUTE_RISK_SCORE } from "../constants";
import { geometrySchema, lineStringSchema } from "../geojson-schemas";
import { KNOWN_ROUTE_REVIEW_PLACE_IDS } from "./places";
import {
	ROUTE_CANDIDATE_SOURCES,
	ROUTE_RECOMMENDATION_RULES,
	ROUTE_RECOMMENDATIONS,
	ROUTE_RISK_HORIZONS,
	ROUTE_RISK_LEVELS,
	ROUTE_SIGNAL_KINDS,
} from "./risk";

export const placeIdSchema = z.enum(KNOWN_ROUTE_REVIEW_PLACE_IDS);
export const routeRiskAssessmentSchema = z.object({
	horizon: z.enum(ROUTE_RISK_HORIZONS),
	level: z.enum(ROUTE_RISK_LEVELS),
	score: z.number().min(MIN_ROUTE_RISK_SCORE).max(MAX_ROUTE_RISK_SCORE),
});

export const routeRecommendationSchema = z.object({
	action: z.enum(ROUTE_RECOMMENDATIONS),
	rule: z.enum(ROUTE_RECOMMENDATION_RULES),
	suggestedDepartureAt: z.date().nullable(),
	expectedDelayS: z.number().nonnegative().nullable(),
});

export const routeSignalSchema = z.object({
	id: z.string(),
	kind: z.enum(ROUTE_SIGNAL_KINDS),
	title: z.string(),
	detail: z.string().nullable(),
	source: z.string(),
	sourceUrl: z.url().nullable(),
	observedAt: z.date(),
	validFrom: z.date().nullable(),
	validUntil: z.date().nullable(),
	roadStatus: z.enum(ROAD_STATUSES).nullable(),
	incidentId: z.string().nullable(),
	incidentCategory: z.enum(INCIDENT_CATEGORIES).nullable(),
	geometry: geometrySchema.nullable(),
	segmentIds: z.array(z.string()),
});

export const routeSegmentSchema = z.object({
	id: z.string(),
	startM: z.number().nonnegative(),
	endM: z.number().nonnegative(),
	geometry: lineStringSchema,
	risk: z.array(routeRiskAssessmentSchema),
});

export const routeCandidateSchema = z.object({
	id: z.string(),
	source: z.enum(ROUTE_CANDIDATE_SOURCES),
	name: z.string(),
	roadCodes: z.array(z.string()),
	geometry: lineStringSchema,
	distanceM: z.number().nonnegative(),
	durationS: z.number().nonnegative(),
	eligibility: z.object({
		eligible: z.boolean(),
		maxAxleCount: z.number().int().positive().nullable(),
		restriction: z.string().nullable(),
	}),
	risk: z.array(routeRiskAssessmentSchema),
	recommendation: routeRecommendationSchema,
	segments: z.array(routeSegmentSchema),
	signals: z.array(routeSignalSchema),
	explanation: z.string().nullable(),
});

export const routeReviewSchema = z.object({
	id: z.string(),
	originPlaceId: placeIdSchema,
	destinationPlaceId: placeIdSchema,
	vehicleId: z.string(),
	vehicleAxleCount: z.number().int().positive(),
	departureAt: z.date(),
	horizons: z.array(z.enum(ROUTE_RISK_HORIZONS)),
	recommendedCandidateId: z.string().nullable(),
	candidates: z.array(routeCandidateSchema),
	evaluatedAt: z.date(),
});

export interface StoredRouteReview extends z.infer<typeof routeReviewSchema> {}
export const persistedRouteReviewSchema = routeReviewSchema.extend({
	departureAt: z.coerce.date(),
	evaluatedAt: z.coerce.date(),
	candidates: z.array(
		routeCandidateSchema.extend({
			recommendation: routeRecommendationSchema.extend({
				suggestedDepartureAt: z.coerce.date().nullable(),
			}),
			signals: z.array(
				routeSignalSchema.extend({
					observedAt: z.coerce.date(),
					validFrom: z.coerce.date().nullable(),
					validUntil: z.coerce.date().nullable(),
				}),
			),
		}),
	),
});

export const routeCandidateSummarySchema = routeCandidateSchema.pick({
	id: true,
	source: true,
	name: true,
	distanceM: true,
	durationS: true,
	risk: true,
	recommendation: true,
});
export const plannedTripSummarySchema = z.object({
	id: z.string(),
	vehicleId: z.string(),
	vehicleName: z.string().nullable(),
	name: z.string(),
	originPlaceId: placeIdSchema,
	destinationPlaceId: placeIdSchema,
	departureAt: z.date(),
	status: z.enum(TRIP_STATUSES),
	chosenCandidate: routeCandidateSummarySchema,
	lastEvaluatedAt: z.date(),
	createdAt: z.date(),
});

const persistedRouteCandidateSummarySchema = routeCandidateSummarySchema.extend(
	{
		recommendation: routeRecommendationSchema.extend({
			suggestedDepartureAt: z.coerce.date().nullable(),
		}),
	},
);
export const persistedPlannedTripSummarySchema =
	plannedTripSummarySchema.extend({
		chosenCandidate: persistedRouteCandidateSummarySchema,
	});
