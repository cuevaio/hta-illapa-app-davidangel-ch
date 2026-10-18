import type { RouteReviewPlaceId } from "@hack-the-andes-project/business/route-review/places";
import type {
	RouteCandidateSource,
	RouteRecommendation,
	RouteRecommendationRule,
	RouteRiskHorizon,
	RouteRiskLevel,
	RouteSignalKind,
} from "@hack-the-andes-project/business/route-review/risk";
import {
	VEHICLE_TYPES,
	type VehicleTypeId,
} from "@hack-the-andes-project/business/route-review/vehicle-types";
import type { Geometry, LineString } from "geojson";
import type { Incident } from "./incident";

export interface RouteReviewRiskAssessment {
	horizon: RouteRiskHorizon;
	level: RouteRiskLevel;
	score: number;
}
export interface RouteReviewSignal {
	id: string;
	kind: RouteSignalKind;
	title: string;
	detail: string | null;
	source: string;
	sourceUrl: string | null;
	observedAt: Date;
	validFrom: Date | null;
	validUntil: Date | null;
	roadStatus: Incident["roadStatus"];
	incidentId: string | null;
	incidentCategory: Incident["category"] | null;
	geometry: Geometry | null;
	segmentIds: string[];
}
export interface RouteReviewSegment {
	id: string;
	startM: number;
	endM: number;
	geometry: LineString;
	risk: RouteReviewRiskAssessment[];
}
export interface RouteReviewRecommendation {
	action: RouteRecommendation;
	rule: RouteRecommendationRule;
	suggestedDepartureAt: Date | null;
	expectedDelayS: number | null;
}
export interface RouteReviewCandidate {
	id: string;
	source: RouteCandidateSource;
	name: string;
	roadCodes: string[];
	geometry: LineString;
	distanceM: number;
	durationS: number;
	eligibility: {
		eligible: boolean;
		maxAxleCount: number | null;
		restriction: string | null;
	};
	risk: RouteReviewRiskAssessment[];
	recommendation: RouteReviewRecommendation;
	segments: RouteReviewSegment[];
	signals: RouteReviewSignal[];
	explanation: string | null;
}
export interface RouteReview {
	id: string;
	originPlaceId: RouteReviewPlaceId;
	destinationPlaceId: RouteReviewPlaceId;
	vehicleId: string;
	vehicleAxleCount: number;
	departureAt: Date;
	horizons: RouteRiskHorizon[];
	recommendedCandidateId: string | null;
	candidates: RouteReviewCandidate[];
	evaluatedAt: Date;
}
export interface RouteReviewTripSummary {
	id: string;
	name: string;
	vehicleName: string | null;
	vehicleId: string;
	originPlaceId: RouteReviewPlaceId;
	destinationPlaceId: RouteReviewPlaceId;
	createdAt: Date;
	departureAt: Date;
	status: "planned" | "active" | "completed" | "cancelled";
	chosenCandidate: Pick<
		RouteReviewCandidate,
		| "id"
		| "source"
		| "name"
		| "distanceM"
		| "durationS"
		| "risk"
		| "recommendation"
	>;
	lastEvaluatedAt: Date;
}
export interface RouteReviewTrip extends RouteReviewTripSummary {
	review: RouteReview;
}
export interface RouteReviewFormValue {
	originPlaceId: RouteReviewPlaceId;
	destinationPlaceId: RouteReviewPlaceId;
	vehicleId: string;
	departureLocal: string;
}
export interface RouteReviewVehicleOption {
	id: string;
	name: string;
	plate: string | null;
	typeLabel: string | null;
	axleCount: number | null;
}
export interface RouteEnumLabels {
	riskLevels: Record<RouteRiskLevel, string>;
	recommendations: Record<RouteRecommendation, string>;
	horizons: Record<RouteRiskHorizon, string>;
	sources: Record<RouteCandidateSource, string>;
	tripStatuses: Record<RouteReviewTripSummary["status"], string>;
}
export interface RouteRecommendationLabels {
	recommendation: (action: RouteRecommendation) => string;
	departAt: (date: Date) => string;
	delay: (seconds: number) => string;
	rerouteTo: (name: string) => string;
}
export function formatRouteRecommendation(
	recommendation: RouteReviewRecommendation,
	labels: RouteRecommendationLabels,
	rerouteName?: string,
): string {
	const actionLabel = labels.recommendation(recommendation.action);
	if (recommendation.action === "delay" && recommendation.suggestedDepartureAt)
		return `${actionLabel} · ${labels.departAt(recommendation.suggestedDepartureAt)}`;
	if (
		recommendation.action === "monitor" &&
		recommendation.expectedDelayS !== null
	)
		return `${actionLabel} · ${labels.delay(recommendation.expectedDelayS)}`;
	if (recommendation.action === "reroute" && rerouteName)
		return `${actionLabel} · ${labels.rerouteTo(rerouteName)}`;
	return actionLabel;
}
export function vehicleTypeShortLabel(
	vehicleTypeId: VehicleTypeId,
	vehicleTypeLabels: Record<VehicleTypeId, string>,
): string {
	return (
		VEHICLE_TYPES[vehicleTypeId].mtcCode ?? vehicleTypeLabels[vehicleTypeId]
	);
}
export interface RouteReviewLabels extends RouteRecommendationLabels {
	recommended: string;
	chosen: string;
	why: string;
	planTrip: string;
	useThisRoute: string;
	illapaGroup: string;
	sutranGroup: string;
	aiExplanation: string;
	noSignals: string;
	ruleLabel: string;
	valid: string;
	risk: string;
	horizonHelp: (horizon: RouteRiskHorizon) => string;
	viewOnMap: string;
	mapLabel: string;
	legend: string;
	expand: string;
	close: string;
	calculating: string;
	origin: string;
	destination: string;
	swap: string;
	vehicle: string;
	departure: string;
	review: string;
	reviewing: string;
	edit: string;
	addVehicle: string;
	setVehicleType: string;
	missingType: string;
	noType: string;
	noMatches: string;
	chooseVehicle: string;
	rescore: string;
	rescoring: string;
	cancelTrip: string;
	departurePassed: string;
	evaluated: string;
	riskLevel: (level: RouteRiskLevel) => string;
	rule: (rule: RouteRecommendationRule) => string;
	signalKind: (kind: RouteSignalKind, count?: number) => string;
	source: (source: RouteCandidateSource) => string;
	horizon: (horizon: RouteRiskHorizon) => string;
	roadStatus: (status: NonNullable<Incident["roadStatus"]>) => string;
	notEligible: (axles: number) => string;
	axles: (axles: number) => string;
	distance: (meters: number) => string;
	duration: (seconds: number) => string;
	dateTime: (date: Date) => string;
	observedAt: (date: Date) => string;
	kmRange: (fromM: number, toM: number) => string;
	tripStatus: (status: RouteReviewTrip["status"]) => string;
}
