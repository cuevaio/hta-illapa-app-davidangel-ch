import type { RiskComponents } from "@hack-the-andes-project/db/schema/risk";
import { describe, expect, it } from "vitest";

import {
	assembleRouteReview,
	type ReviewEdge,
	type ReviewRoute,
} from "./assemble";

const now = new Date("2026-10-18T12:00:00Z");
const departureAt = new Date("2026-10-18T13:00:00Z");

// A straight road east along latitude -11.9: twelve 1 km edges, each on its
// own risk segment, about 12 km in all.
function edge(index: number, roadCode = "PE-22"): ReviewEdge {
	const startLng = -76.5 + index * 0.0092;
	return {
		id: `e${index}`,
		segmentId: `s${index}`,
		roadCode,
		roadName: "Carretera Central",
		lengthM: 1_000,
		travelTimeS: 60,
		lat: -11.9,
		lng: startLng + 0.0046,
		geometry: {
			type: "LineString",
			coordinates: [
				[startLng, -11.9],
				[startLng + 0.0092, -11.9],
			],
		},
	};
}

const road = Array.from({ length: 12 }, (_, index) => edge(index));

function illapaRoute(role: string, edges: ReviewEdge[]): ReviewRoute {
	return {
		id: `illapa:${role}`,
		source: "illapa",
		name: null,
		roadCodes: null,
		eligibility: { eligible: true, maxAxleCount: null, restriction: null },
		edges,
	};
}

function components(overrides: Partial<RiskComponents> = {}): RiskComponents {
	return {
		staticSusceptibility: 0.3,
		massMovement: 0.3,
		slope: 0.3,
		floodExposure: 0,
		history: 0,
		trigger: 0,
		forecastRain: 0,
		antecedentRain: 0,
		officialAlert: 0,
		...overrides,
	};
}

function assessmentsFor(
	segmentId: string,
	scores: Record<24 | 48 | 72, number>,
	overrides: Partial<RiskComponents> = {},
) {
	return ([24, 48, 72] as const).map((horizonHours) => ({
		segmentId,
		horizonHours,
		score: scores[horizonHours],
		forecastPrecipitationMm: horizonHours === 24 ? 32 : 40,
		components: components(overrides),
		weatherFetchedAt: now,
		assessedAt: now,
	}));
}

const quietAssessments = road.flatMap((roadEdge) =>
	assessmentsFor(roadEdge.segmentId ?? "", { 24: 10, 48: 12, 72: 12 }),
);

function review(
	overrides: Partial<Parameters<typeof assembleRouteReview>[0]> = {},
) {
	return assembleRouteReview({
		routes: [illapaRoute("fastest", road)],
		assessments: quietAssessments,
		incidents: [],
		departureAt,
		now,
		...overrides,
	});
}

describe("assembleRouteReview", () => {
	it("splits a route into segments of about 5 km with a simplified route line", () => {
		const [candidate] = review().candidates;

		expect(
			candidate?.segments.map(({ startM, endM }) => [startM, endM]),
		).toEqual([
			[0, 5_000],
			[5_000, 10_000],
			[10_000, 12_000],
		]);
		// The straight road keeps only its segment ends, and the route line runs
		// through exactly those points.
		expect(
			candidate?.segments.map(({ geometry }) => geometry.coordinates.length),
		).toEqual([2, 2, 2]);
		expect(candidate?.geometry.coordinates).toEqual([
			road[0]?.geometry.coordinates[0],
			road[4]?.geometry.coordinates[1],
			road[9]?.geometry.coordinates[1],
			road[11]?.geometry.coordinates[1],
		]);
		expect(candidate).toMatchObject({
			id: "illapa:fastest",
			source: "illapa",
			name: "Carretera Central",
			roadCodes: ["PE-22"],
			distanceM: 12_000,
			durationS: 720,
			eligibility: { eligible: true, maxAxleCount: null, restriction: null },
			explanation: null,
		});
	});

	it("scores each segment per horizon with its riskiest edge and derives now from current conditions", () => {
		const assessments = [
			...quietAssessments.filter(({ segmentId }) => segmentId !== "s6"),
			...assessmentsFor(
				"s6",
				{ 24: 62, 48: 70, 72: 80 },
				{ staticSusceptibility: 0.5, antecedentRain: 0.4 },
			),
		];
		const [candidate] = review({ assessments }).candidates;

		expect(candidate?.segments[1]?.risk).toEqual([
			{ horizon: "now", level: "low", score: 16 },
			{ horizon: "24h", level: "high", score: 62 },
			{ horizon: "48h", level: "high", score: 70 },
			{ horizon: "72h", level: "critical", score: 80 },
		]);
		expect(candidate?.risk.find(({ horizon }) => horizon === "72h")).toEqual({
			horizon: "72h",
			level: "critical",
			score: 80,
		});
	});

	it("leaves horizons without an assessment out of a segment", () => {
		const assessments = quietAssessments.filter(
			({ segmentId }) => !["s10", "s11"].includes(segmentId),
		);

		expect(review({ assessments }).candidates[0]?.segments[2]?.risk).toEqual(
			[],
		);
	});

	it("turns a SUTRAN closure on the road into a confirmed interruption and reroutes", () => {
		const closure = {
			id: "closure",
			source: "sutran_alerts",
			category: "landslide" as const,
			severity: "critical" as const,
			title: "Tránsito interrumpido por huaico en el km 50",
			description: "Maquinaria en la zona.",
			roadStatus: "interrumpido" as const,
			roadCode: "PE-22",
			lat: -11.9,
			lng: road[2]?.lng ?? 0,
			geometry: null,
			observedAt: now,
			validFrom: null,
			validUntil: null,
		};
		const [candidate] = review({ incidents: [closure] }).candidates;

		expect(candidate?.signals).toEqual([
			{
				id: "closure",
				kind: "confirmed",
				title: closure.title,
				detail: closure.description,
				source: "SUTRAN",
				sourceUrl: null,
				observedAt: now,
				validFrom: null,
				validUntil: null,
				roadStatus: "interrumpido",
				incidentId: "closure",
				incidentCategory: "landslide",
				geometry: { type: "Point", coordinates: [closure.lng, -11.9] },
				segmentIds: ["illapa:fastest:0"],
			},
		]);
		expect(candidate?.recommendation).toEqual({
			action: "reroute",
			rule: "confirmed_interruption",
			suggestedDepartureAt: null,
			expectedDelayS: null,
		});
	});

	it("reports official weather alerts touching the route as forecast signals", () => {
		const warning = {
			id: "senamhi",
			source: "senamhi_warnings",
			category: "rain_warning" as const,
			severity: "warning" as const,
			title: "Lluvias de moderada a fuerte intensidad",
			description: null,
			roadStatus: null,
			roadCode: null,
			lat: -11.9,
			lng: road[11]?.lng ?? 0,
			geometry: null,
			observedAt: now,
			validFrom: now,
			validUntil: new Date("2026-10-19T12:00:00Z"),
		};
		const [candidate] = review({ incidents: [warning] }).candidates;

		expect(candidate?.signals).toEqual([
			expect.objectContaining({
				id: "senamhi",
				kind: "forecast",
				source: "SENAMHI",
				geometry: null,
				incidentId: "senamhi",
				segmentIds: ["illapa:fastest:2"],
			}),
		]);
	});

	it("flags forecast rain inside the trip window and delays without a lower alternative", () => {
		const assessments = [
			...quietAssessments.filter(({ segmentId }) => segmentId !== "s1"),
			...assessmentsFor("s1", { 24: 58, 48: 58, 72: 58 }),
		];
		const [candidate] = review({ assessments }).candidates;

		expect(candidate?.signals).toEqual([
			expect.objectContaining({
				id: "illapa:fastest:forecast",
				kind: "forecast",
				source: "Open-Meteo",
				detail: "Hasta 32 mm en 24 h.",
				incidentCategory: "rain_warning",
				validFrom: now,
				validUntil: new Date("2026-10-19T12:00:00Z"),
				segmentIds: ["illapa:fastest:0"],
			}),
		]);
		expect(candidate?.recommendation).toMatchObject({
			action: "delay",
			rule: "forecast_in_window",
		});
	});

	it("reports highly susceptible segments as baseline exposure only", () => {
		const assessments = [
			...quietAssessments.filter(({ segmentId }) => segmentId !== "s4"),
			...assessmentsFor(
				"s4",
				{ 24: 15, 48: 15, 72: 15 },
				{ staticSusceptibility: 0.8 },
			),
		];
		const [candidate] = review({ assessments }).candidates;

		expect(candidate?.signals).toEqual([
			expect.objectContaining({
				id: "illapa:fastest:baseline",
				kind: "baseline",
				source: "INGEMMET",
				segmentIds: ["illapa:fastest:0"],
			}),
		]);
		expect(candidate?.recommendation).toMatchObject({
			action: "continue",
			rule: "baseline_only",
		});
	});

	it("recommends by the risk inside the trip window, not a later storm", () => {
		const detour = road.map((roadEdge) => ({
			...edge(Number(roadEdge.id.slice(1)), "PE-20"),
			id: `d${roadEdge.id}`,
			segmentId: `d${roadEdge.segmentId}`,
			roadName: "Vía Canta",
			travelTimeS: 90,
		}));
		const assessments = [
			...quietAssessments.filter(({ segmentId }) => segmentId !== "s1"),
			...assessmentsFor("s1", { 24: 20, 48: 20, 72: 90 }),
			...detour.flatMap((detourEdge) =>
				assessmentsFor(detourEdge.segmentId, { 24: 40, 48: 40, 72: 40 }),
			),
		];
		const result = review({
			routes: [illapaRoute("fastest", road), illapaRoute("safest", detour)],
			assessments,
		});

		expect(result.recommendedCandidateId).toBe("illapa:fastest");
	});

	it("recommends the lower-risk route and reroutes the risky one", () => {
		const detour = road.map((roadEdge) => ({
			...edge(Number(roadEdge.id.slice(1)), "PE-20"),
			id: `d${roadEdge.id}`,
			segmentId: `d${roadEdge.segmentId}`,
			roadName: "Vía Canta",
			travelTimeS: 90,
		}));
		const assessments = [
			...quietAssessments.filter(({ segmentId }) => segmentId !== "s1"),
			...assessmentsFor("s1", { 24: 78, 48: 78, 72: 78 }),
			...detour.flatMap((detourEdge) =>
				assessmentsFor(detourEdge.segmentId, { 24: 20, 48: 20, 72: 20 }),
			),
		];
		const result = review({
			routes: [illapaRoute("fastest", road), illapaRoute("safest", detour)],
			assessments,
		});

		expect(result.recommendedCandidateId).toBe("illapa:safest");
		expect(
			result.candidates.map(({ id, recommendation }) => [
				id,
				recommendation.action,
			]),
		).toEqual([
			["illapa:fastest", "reroute"],
			["illapa:safest", "continue"],
		]);
	});

	it("merges routes that follow the same edges", () => {
		expect(
			review({
				routes: [illapaRoute("fastest", road), illapaRoute("safest", road)],
			}).candidates.map(({ id }) => id),
		).toEqual(["illapa:fastest"]);
	});

	it("lists the four horizons", () => {
		expect(review().horizons).toEqual(["now", "24h", "48h", "72h"]);
	});

	it("lists a route that follows a SUTRAN detour once, as the detour", () => {
		const detour: ReviewRoute = {
			id: "sutran:carretera-central:canta",
			source: "sutran",
			name: "LIMA – CANTA – HUAYLLAY – UNISH – DV. PASCO",
			roadCodes: [],
			eligibility: {
				eligible: false,
				maxAxleCount: 5,
				restriction:
					"Transitabilidad de vehículos ligeros, medianos y grandes (hasta 5 ejes)",
			},
			edges: road.map((roadEdge) => ({
				...roadEdge,
				id: `sutran-${roadEdge.id}`,
				roadCode: null,
				roadName: null,
			})),
		};
		const result = review({
			routes: [illapaRoute("fastest", road), detour],
		});

		expect(
			result.candidates.map(({ id, source, name, eligibility }) => [
				id,
				source,
				name,
				eligibility.eligible,
			]),
		).toEqual([
			[
				"sutran:carretera-central:canta",
				"sutran",
				"LIMA – CANTA – HUAYLLAY – UNISH – DV. PASCO",
				false,
			],
		]);
		expect(result.recommendedCandidateId).toBeNull();
	});

	it("does not recommend a mostly unassessed route over an assessed one", () => {
		const unscored = road.map((roadEdge) => ({
			...roadEdge,
			id: `u${roadEdge.id}`,
			segmentId: `u${roadEdge.segmentId}`,
		}));
		const assessments = [
			...quietAssessments.map((assessment) => ({ ...assessment, score: 30 })),
			...unscored
				.slice(0, 2)
				.flatMap((unscoredEdge) =>
					assessmentsFor(unscoredEdge.segmentId, { 24: 5, 48: 5, 72: 5 }),
				),
		];
		const result = review({
			routes: [illapaRoute("fastest", road), illapaRoute("safest", unscored)],
			assessments,
		});

		expect(result.recommendedCandidateId).toBe("illapa:fastest");
	});

	it("rounds scores to whole points", () => {
		const assessments = quietAssessments.map((assessment) => ({
			...assessment,
			score: 26.6,
		}));

		expect(review({ assessments }).candidates[0]?.risk[1]).toEqual({
			horizon: "24h",
			level: "moderate",
			score: 27,
		});
	});

	it("names a route after its main roads and drops short urban roads", () => {
		const urbanStreet = {
			...edge(12, "LM-618"),
			roadName: "Avenida Nicolás Ayllón",
			lengthM: 200,
		};
		const [candidate] = review({
			routes: [illapaRoute("fastest", [...road, urbanStreet])],
		}).candidates;

		expect(candidate?.name).toBe("Carretera Central");
		expect(candidate?.roadCodes).toEqual(["PE-22"]);
	});

	it("keeps the engine level of a score just under a threshold", () => {
		const assessments = [
			...quietAssessments.filter(({ segmentId }) => segmentId !== "s1"),
			...assessmentsFor("s1", { 24: 49.6, 48: 49.6, 72: 49.6 }),
		];
		const [candidate] = review({ assessments }).candidates;

		expect(candidate?.segments[0]?.risk[1]).toEqual({
			horizon: "24h",
			level: "moderate",
			score: 50,
		});
		expect(candidate?.risk[1]).toEqual({
			horizon: "24h",
			level: "moderate",
			score: 50,
		});
		expect(candidate?.recommendation.rule).not.toBe("forecast_in_window");
	});
});
