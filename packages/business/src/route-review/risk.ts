export const ROUTE_RISK_LEVELS = [
	"low",
	"moderate",
	"high",
	"critical",
] as const;
export type RouteRiskLevel = (typeof ROUTE_RISK_LEVELS)[number];

export const ROUTE_RISK_HORIZONS = ["now", "24h", "48h", "72h"] as const;
export type RouteRiskHorizon = (typeof ROUTE_RISK_HORIZONS)[number];

export const ROUTE_RECOMMENDATIONS = [
	"continue",
	"monitor",
	"delay",
	"reroute",
] as const;
export type RouteRecommendation = (typeof ROUTE_RECOMMENDATIONS)[number];

export const ROUTE_RECOMMENDATION_RULES = [
	"confirmed_interruption",
	"confirmed_restriction",
	"forecast_in_window",
	"forecast_below_high",
	"baseline_only",
	"nothing_relevant",
] as const;
export type RouteRecommendationRule =
	(typeof ROUTE_RECOMMENDATION_RULES)[number];

export const ROUTE_SIGNAL_KINDS = [
	"confirmed",
	"forecast",
	"baseline",
] as const;
export type RouteSignalKind = (typeof ROUTE_SIGNAL_KINDS)[number];

export const ROUTE_CANDIDATE_SOURCES = ["illapa", "sutran"] as const;
export type RouteCandidateSource = (typeof ROUTE_CANDIDATE_SOURCES)[number];
