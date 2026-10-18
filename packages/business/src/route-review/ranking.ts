import {
	RISK_HORIZONS_HOURS,
	type RiskHorizonHours,
} from "@hack-the-andes-project/db/schema/risk";
import { MS_PER_HOUR, MS_PER_SECOND } from "../constants";
import type { RouteRiskHorizon } from "./risk";

interface ScoredAssessment {
	score: number;
}

interface HorizonAssessment {
	horizon: RouteRiskHorizon;
}

export const HORIZON_BY_HOURS: Record<RiskHorizonHours, RouteRiskHorizon> = {
	24: "24h",
	48: "48h",
	72: "72h",
};
const [, , LONGEST_HORIZON_HOURS] = RISK_HORIZONS_HOURS;

interface RankableRouteCandidate {
	eligibility: { eligible: boolean };
	risk: ScoredAssessment[];
	durationS: number;
}

export function peakRiskAssessment<Assessment extends ScoredAssessment>(
	risk: Assessment[],
): Assessment | undefined {
	return risk.reduce<Assessment | undefined>(
		(peak, assessment) =>
			peak && peak.score >= assessment.score ? peak : assessment,
		undefined,
	);
}

// The trip window is the smallest stored horizon that still covers arrival.
export function tripWindowHours(
	departureAt: Date,
	durationS: number,
	now: Date,
): RiskHorizonHours {
	const hoursUntilArrival =
		(departureAt.getTime() + durationS * MS_PER_SECOND - now.getTime()) /
		MS_PER_HOUR;
	return (
		RISK_HORIZONS_HOURS.find((hours) => hours >= hoursUntilArrival) ??
		LONGEST_HORIZON_HOURS
	);
}

export function tripWindowRiskAssessment<Assessment extends HorizonAssessment>(
	risk: Assessment[],
	departureAt: Date,
	durationS: number,
	evaluatedAt: Date,
): Assessment | undefined {
	const windowHorizon =
		HORIZON_BY_HOURS[tripWindowHours(departureAt, durationS, evaluatedAt)];
	return risk.find(({ horizon }) => horizon === windowHorizon);
}

export function compareRouteCandidates(
	first: RankableRouteCandidate,
	second: RankableRouteCandidate,
) {
	return (
		Number(second.eligibility.eligible) - Number(first.eligibility.eligible) ||
		(peakRiskAssessment(first.risk)?.score ?? 0) -
			(peakRiskAssessment(second.risk)?.score ?? 0) ||
		first.durationS - second.durationS
	);
}
