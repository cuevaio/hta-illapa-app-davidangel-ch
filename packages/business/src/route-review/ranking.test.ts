import { describe, expect, it } from "vitest";

import {
	compareRouteCandidates,
	peakRiskAssessment,
	tripWindowRiskAssessment,
} from "./ranking";

function candidate(
	name: string,
	eligible: boolean,
	scores: number[],
	durationS: number,
) {
	return {
		name,
		eligibility: { eligible },
		risk: scores.map((score) => ({ score })),
		durationS,
	};
}

describe("peakRiskAssessment", () => {
	it("returns the assessment with the highest score", () => {
		expect(
			peakRiskAssessment([
				{ horizon: "now", score: 40 },
				{ horizon: "24h", score: 72 },
			]),
		).toEqual({ horizon: "24h", score: 72 });
	});

	it("returns undefined without assessments", () => {
		expect(peakRiskAssessment([])).toBeUndefined();
	});
});

describe("compareRouteCandidates", () => {
	it("puts eligible candidates first, then lower peak risk, then shorter duration", () => {
		const ordered = [
			candidate("ineligible-safe", false, [10, 12], 100),
			candidate("risky", true, [40, 72], 100),
			candidate("safe-slow", true, [30, 44], 900),
			candidate("safe-fast", true, [44, 20], 300),
		]
			.toSorted(compareRouteCandidates)
			.map(({ name }) => name);

		expect(ordered).toEqual([
			"safe-fast",
			"safe-slow",
			"risky",
			"ineligible-safe",
		]);
	});
});

describe("tripWindowRiskAssessment", () => {
	const risk = [
		{ horizon: "now" as const, level: "moderate" as const, score: 34 },
		{ horizon: "24h" as const, level: "moderate" as const, score: 44 },
		{ horizon: "72h" as const, level: "critical" as const, score: 79 },
	];
	const evaluatedAt = new Date("2026-10-18T11:00:00Z");

	it("reads the horizon that covers the trip's arrival, not a later storm", () => {
		expect(
			tripWindowRiskAssessment(
				risk,
				new Date("2026-10-18T11:15:00Z"),
				5.5 * 60 * 60,
				evaluatedAt,
			),
		).toMatchObject({ horizon: "24h", score: 44 });
	});

	it("reads the longest horizon for a trip arriving days later", () => {
		expect(
			tripWindowRiskAssessment(
				risk,
				new Date("2026-10-20T10:00:00Z"),
				5.5 * 60 * 60,
				evaluatedAt,
			),
		).toMatchObject({ horizon: "72h", score: 79 });
	});
});
