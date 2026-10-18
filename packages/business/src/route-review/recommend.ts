import type { RoadStatus } from "@hack-the-andes-project/db/schema/scraper";

import { riskLevelForScore } from "../risk/score";
import type {
	RouteRecommendation,
	RouteRecommendationRule,
	RouteRiskLevel,
	RouteSignalKind,
} from "./risk";

export interface RecommendationSignal {
	kind: RouteSignalKind;
	roadStatus: RoadStatus | null;
}

export interface RecommendRouteInput {
	signals: RecommendationSignal[];
	// Peak level of the route inside the horizon that covers the trip.
	windowLevel: RouteRiskLevel;
	hasLowerRiskAlternative: boolean;
}

export interface RouteRecommendationDecision {
	action: RouteRecommendation;
	rule: RouteRecommendationRule;
	suggestedDepartureAt: Date | null;
	expectedDelayS: number | null;
}

export function routeRiskLevelForScore(score: number): RouteRiskLevel {
	const level = riskLevelForScore(score);
	return level === "very_high" ? "critical" : level;
}

// PRD rule table, first match wins. Assessments only keep the wettest 24 h
// block per horizon, so whether a later window is drier cannot be told:
// a high forecast reroutes when an eligible path is lower and otherwise
// delays without a suggested departure.
export function recommendRoute({
	signals,
	windowLevel,
	hasLowerRiskAlternative,
}: RecommendRouteInput): RouteRecommendationDecision {
	const decision = (
		action: RouteRecommendation,
		rule: RouteRecommendationRule,
	): RouteRecommendationDecision => ({
		action,
		rule,
		suggestedDepartureAt: null,
		expectedDelayS: null,
	});
	const confirmedStatuses = new Set(
		signals
			.filter((signal) => signal.kind === "confirmed")
			.map((signal) => signal.roadStatus),
	);
	if (confirmedStatuses.has("interrumpido")) {
		return decision("reroute", "confirmed_interruption");
	}
	if (confirmedStatuses.has("restringido")) {
		return decision("monitor", "confirmed_restriction");
	}
	if (windowLevel === "high" || windowLevel === "critical") {
		return decision(
			hasLowerRiskAlternative ? "reroute" : "delay",
			"forecast_in_window",
		);
	}
	if (signals.some((signal) => signal.kind === "forecast")) {
		return decision("continue", "forecast_below_high");
	}
	if (signals.some((signal) => signal.kind === "baseline")) {
		return decision("continue", "baseline_only");
	}
	return decision("continue", "nothing_relevant");
}
