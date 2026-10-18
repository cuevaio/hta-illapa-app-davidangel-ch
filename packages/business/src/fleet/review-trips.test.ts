import { createDb } from "@hack-the-andes-project/db";
import type { trip, vehicle } from "@hack-the-andes-project/db/schema/fleet";
import { createRequestLogger } from "evlog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MS_PER_SECOND, ROUTE_REVIEW_RETENTION_MS } from "../constants";
import { simulateDemoPositions } from "../providers/demo";
import * as evaluation from "../route-review/evaluate";
import {
	ROUTE_REVIEW_PLACE_IDS,
	ROUTE_REVIEW_PLACES,
} from "../route-review/places";
import {
	persistedRouteReviewSchema,
	type StoredRouteReview,
} from "../route-review/schemas";
import {
	chooseReviewTripCandidate,
	evaluateVehicleReview,
	getReviewTrip,
	listReviewTrips,
	loadReview,
	plannedRouteColumns,
	planReviewTrip,
	reevaluatedCandidate,
	reevaluateReviewTrip,
	requireEligibleCandidate,
	startReviewTrip,
	validateTripStart,
	vehicleProfile,
} from "./review-trips";

const query = vi.hoisted(() => vi.fn());
vi.mock("mysql2/promise", async (importOriginal) => ({
	...(await importOriginal<object>()),
	default: { createConnection: async () => ({ config: {}, query }) },
}));
const database = await createDb({
	host: "mock",
	port: 0,
	user: "mock",
	password: "mock",
	database: "mock",
});
const now = new Date("2026-10-18T13:00:00Z");
const review: StoredRouteReview = {
	id: "review",
	vehicleId: "vehicle",
	originPlaceId: "lima",
	destinationPlaceId: "huancayo",
	vehicleAxleCount: 6,
	departureAt: now,
	evaluatedAt: now,
	horizons: ["now"],
	recommendedCandidateId: "candidate",
	candidates: [
		{
			id: "candidate",
			source: "illapa",
			name: "Central",
			roadCodes: [],
			geometry: {
				type: "LineString",
				coordinates: [
					[-77, -12],
					[-76, -12],
				],
			},
			distanceM: 100_000,
			durationS: 3600,
			eligibility: { eligible: true, maxAxleCount: null, restriction: null },
			risk: [],
			recommendation: {
				action: "continue",
				rule: "nothing_relevant",
				suggestedDepartureAt: now,
				expectedDelayS: null,
			},
			segments: [],
			signals: [
				{
					id: "signal",
					kind: "forecast",
					title: "Rain",
					detail: null,
					source: "weather",
					sourceUrl: null,
					observedAt: now,
					validFrom: now,
					validUntil: null,
					roadStatus: null,
					incidentId: null,
					incidentCategory: null,
					geometry: null,
					segmentIds: [],
				},
			],
			explanation: null,
		},
	],
};
const selectedVehicle: typeof vehicle.$inferSelect = {
	id: "vehicle",
	organizationId: "organization",
	connectionId: "connection",
	externalId: "demo-callao",
	vehicleTypeId: "t3s3",
	axleCount: 6,
	grossWeightKg: null,
	name: "Truck",
	plate: null,
	lastLat: null,
	lastLng: null,
	lastHeading: null,
	lastSpeedKmh: null,
	lastPositionAt: null,
	active: true,
	createdAt: now,
	updatedAt: now,
};
const storedTrip: typeof trip.$inferSelect = {
	...plannedRouteColumns(review, requireEligibleCandidate(review, "candidate")),
	id: "trip",
	organizationId: "organization",
	vehicleId: "vehicle",
	name: "Delivery",
	status: "planned",
	etaAt: null,
	startedAt: null,
	createdAt: now,
	updatedAt: now,
};
const context = {
	db: database,
	organizationId: "organization",
	osrmBaseUrl: "https://routing.example.com",
	log: createRequestLogger(),
};

beforeEach(() => {
	query.mockResolvedValue([{ affectedRows: 1 }, []]);
	vi.spyOn(database.query.vehicle, "findFirst").mockResolvedValue(
		selectedVehicle,
	);
	vi.spyOn(database.query.trip, "findFirst").mockResolvedValue(storedTrip);
	vi.spyOn(database.query.routeReview, "findFirst").mockResolvedValue({
		id: review.id,
		organizationId: context.organizationId,
		vehicleId: review.vehicleId,
		originPlaceId: review.originPlaceId,
		destinationPlaceId: review.destinationPlaceId,
		departureAt: now,
		review: JSON.parse(JSON.stringify(review)),
		evaluatedAt: now,
		createdAt: now,
	});
});
afterEach(() => {
	vi.restoreAllMocks();
	query.mockReset();
});

describe("review trip rules", () => {
	it("hydrates every persisted review date after a JSON round trip", () => {
		expect(
			persistedRouteReviewSchema.parse(JSON.parse(JSON.stringify(review))),
		).toEqual(review);
	});
	it("still reads a review stored for a place that is no longer offered", () => {
		const storedReview: StoredRouteReview = {
			...review,
			destinationPlaceId: "cerro_de_pasco",
		};

		expect(ROUTE_REVIEW_PLACE_IDS).not.toContain("cerro_de_pasco");
		expect(
			persistedRouteReviewSchema.parse(
				JSON.parse(JSON.stringify(storedReview)),
			),
		).toEqual(storedReview);
	});
	it("keeps imported vehicles unprofiled until their profile is set", () => {
		expect(
			vehicleProfile({
				vehicleTypeId: null,
				axleCount: null,
				grossWeightKg: null,
			}),
		).toBeNull();
		expect(vehicleProfile(selectedVehicle)).toEqual({
			vehicleTypeId: "t3s3",
			axleCount: 6,
			grossWeightKg: null,
		});
	});
	it("fills the mandatory fleet route columns from the review", () => {
		expect(
			plannedRouteColumns(
				review,
				requireEligibleCandidate(review, "candidate"),
			),
		).toMatchObject({
			originLat: ROUTE_REVIEW_PLACES.lima.lat,
			destinationLng: ROUTE_REVIEW_PLACES.huancayo.lng,
			destinationName: "Huancayo",
			routeGeometry: review.candidates[0]?.geometry,
			routeDistanceM: 100_000,
			routeDurationS: 3600,
		});
	});
	it("rejects missing or ineligible candidates", () => {
		expect(() => requireEligibleCandidate(review, "missing")).toThrow();
		const restrictedReview = structuredClone(review);
		restrictedReview.candidates = restrictedReview.candidates.map(
			(candidate) => ({
				...candidate,
				eligibility: { ...candidate.eligibility, eligible: false },
			}),
		);
		expect(() =>
			requireEligibleCandidate(restrictedReview, "candidate"),
		).toThrow();
	});
	it("retains the choice, falls back to the recommendation, and accepts no recommendation", () => {
		expect(reevaluatedCandidate(review, "candidate")?.id).toBe("candidate");
		expect(reevaluatedCandidate(review, "missing")?.id).toBe("candidate");
		expect(
			reevaluatedCandidate(
				{ ...review, recommendedCandidateId: null },
				"missing",
			),
		).toBeNull();
	});
	it.each(["active", "completed", "cancelled"] as const)(
		"rejects starting a %s trip",
		(status) => {
			expect(() =>
				validateTripStart({ status }, selectedVehicle, false),
			).toThrow();
		},
	);
	it("rejects a manual vehicle and a second active trip", () => {
		expect(() =>
			validateTripStart(storedTrip, { connectionId: null }, false),
		).toThrow();
		expect(() =>
			validateTripStart(storedTrip, selectedVehicle, true),
		).toThrow();
	});
});

describe("review trip persistence", () => {
	it("scopes review lookup to the organization", async () => {
		await loadReview(context, "review");
		expect(database.query.routeReview.findFirst).toHaveBeenCalledWith({
			where: { id: "review", organizationId: "organization" },
		});
		vi.mocked(database.query.routeReview.findFirst).mockResolvedValue(
			undefined,
		);
		await expect(loadReview(context, "foreign-review")).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
	it("evaluates from a scoped vehicle profile and persists the document", async () => {
		const evaluate = vi
			.spyOn(evaluation, "evaluateRouteReview")
			.mockResolvedValue(review);
		const result = await evaluateVehicleReview(context, {
			vehicleId: "vehicle",
			originPlaceId: "lima",
			destinationPlaceId: "huancayo",
			departureAt: now,
		});
		expect(evaluate).toHaveBeenCalledWith(
			expect.objectContaining({
				axleCount: 6,
				origin: ROUTE_REVIEW_PLACES.lima,
			}),
		);
		expect(result.vehicleId).toBe("vehicle");
		expect(query).toHaveBeenCalledWith(
			expect.objectContaining({
				sql: expect.stringContaining(
					"insert into `hack_the_andes_route_review`",
				),
			}),
			expect.arrayContaining(["organization", "vehicle"]),
		);
	});
	it("prunes only old organization reviews that no trip references", async () => {
		vi.spyOn(evaluation, "evaluateRouteReview").mockResolvedValue(review);
		vi.useFakeTimers();
		try {
			vi.setSystemTime(now);
			await evaluateVehicleReview(context, review);
			const reviewDeletion = query.mock.calls.find(([options]) =>
				options.sql.startsWith("delete from `hack_the_andes_route_review`"),
			);
			expect(reviewDeletion?.[0].sql).toContain(
				"`hack_the_andes_route_review`.`organization_id` = ?",
			);
			expect(reviewDeletion?.[0].sql).toContain(
				"`hack_the_andes_route_review`.`created_at` < ?",
			);
			expect(reviewDeletion?.[0].sql).toContain("not exists (select");
			expect(reviewDeletion?.[0].sql).toContain(
				"`hack_the_andes_trip`.`review_id` = `hack_the_andes_route_review`.`id`",
			);
			expect(reviewDeletion?.[1]).toEqual([
				context.organizationId,
				new Date(now.getTime() - ROUTE_REVIEW_RETENTION_MS)
					.toISOString()
					.replace("T", " ")
					.replace("Z", ""),
			]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("rejects missing vehicles and absent profiles before evaluating", async () => {
		const evaluate = vi.spyOn(evaluation, "evaluateRouteReview");
		vi.mocked(database.query.vehicle.findFirst).mockResolvedValue(undefined);
		await expect(evaluateVehicleReview(context, review)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		vi.mocked(database.query.vehicle.findFirst).mockResolvedValue({
			...selectedVehicle,
			axleCount: null,
		});
		await expect(evaluateVehicleReview(context, review)).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		expect(evaluate).not.toHaveBeenCalled();
	});
	it("saves a planned trip and returns its persisted review on reload", async () => {
		expect(
			await planReviewTrip(context, {
				reviewId: review.id,
				candidateId: "candidate",
				name: "Delivery",
			}),
		).toMatchObject({
			status: "planned",
			vehicleId: "vehicle",
			chosenCandidate: { id: "candidate" },
		});
		expect(query).toHaveBeenCalledWith(
			expect.objectContaining({
				sql: expect.stringContaining("insert into `hack_the_andes_trip`"),
			}),
			expect.arrayContaining(["planned", "review"]),
		);
		expect(await getReviewTrip(context, storedTrip.id)).toMatchObject({
			id: storedTrip.id,
			review,
		});
	});
	it("lists only trip summaries without reading reviews or route geometry", async () => {
		const candidate = requireEligibleCandidate(review, "candidate");
		const candidateSummary = {
			id: candidate.id,
			source: candidate.source,
			name: candidate.name,
			distanceM: candidate.distanceM,
			durationS: candidate.durationS,
			risk: candidate.risk,
			recommendation: candidate.recommendation,
		};
		query.mockResolvedValue([
			[
				[
					storedTrip.id,
					storedTrip.vehicleId,
					selectedVehicle.name,
					storedTrip.name,
					storedTrip.originPlaceId,
					storedTrip.destinationPlaceId,
					now.toISOString().replace("T", " ").replace("Z", ""),
					storedTrip.status,
					JSON.parse(JSON.stringify(candidateSummary)),
					now.toISOString().replace("T", " ").replace("Z", ""),
					now.toISOString().replace("T", " ").replace("Z", ""),
				],
			],
			[],
		]);
		const summaries = await listReviewTrips(context);
		expect(summaries).toEqual([
			{
				id: storedTrip.id,
				vehicleId: storedTrip.vehicleId,
				vehicleName: selectedVehicle.name,
				name: storedTrip.name,
				originPlaceId: review.originPlaceId,
				destinationPlaceId: review.destinationPlaceId,
				departureAt: now,
				status: "planned",
				chosenCandidate: candidateSummary,
				lastEvaluatedAt: now,
				createdAt: now,
			},
		]);
		const listQuery = query.mock.calls[0];
		expect(listQuery?.[0].sql).toContain("`chosen_candidate`");
		expect(listQuery?.[0].sql).not.toContain("hack_the_andes_route_review");
		expect(listQuery?.[0].sql).not.toContain("route_geometry");
		expect(listQuery?.[1]).toEqual(
			expect.arrayContaining([context.organizationId]),
		);
		expect(database.query.routeReview.findFirst).not.toHaveBeenCalled();
	});

	it("refreshes fleet route columns when choosing a candidate", async () => {
		await chooseReviewTripCandidate(context, {
			id: storedTrip.id,
			candidateId: "candidate",
		});
		expect(query).toHaveBeenCalledWith(
			expect.objectContaining({
				sql: expect.stringMatching(
					/`chosen_candidate` = .*`route_geometry` = /,
				),
			}),
			expect.arrayContaining(["planned", "organization", "trip"]),
		);
	});
	it("does not edit an active trip", async () => {
		vi.mocked(database.query.trip.findFirst).mockResolvedValue({
			...storedTrip,
			status: "active",
		});
		await expect(
			chooseReviewTripCandidate(context, {
				id: "trip",
				candidateId: "candidate",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(reevaluateReviewTrip(context, "trip")).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	});
	it("rescoring with no recommendation preserves an inspectable, ineligible previous route", async () => {
		vi.spyOn(evaluation, "evaluateRouteReview").mockResolvedValue({
			horizons: ["now"],
			candidates: [],
			recommendedCandidateId: null,
		});
		await expect(reevaluateReviewTrip(context, "trip")).resolves.toBeDefined();
		expect(query).toHaveBeenCalledWith(
			expect.objectContaining({
				sql: expect.stringContaining("update `hack_the_andes_route_review`"),
			}),
			expect.arrayContaining([expect.stringContaining('"eligible":false')]),
		);
		expect(query).toHaveBeenCalledWith(
			expect.objectContaining({
				sql: expect.stringContaining("`chosen_candidate` = ?"),
			}),
			expect.arrayContaining([expect.stringContaining('"id":"candidate"')]),
		);
		expect(context.log.getContext()).toMatchObject({
			fleet: { candidateFallback: true, noRecommendedCandidate: true },
		});
	});
	it("starts at the current time and computes ETA from the chosen duration", async () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(now);
			vi.mocked(database.query.trip.findFirst)
				.mockResolvedValueOnce(storedTrip)
				.mockResolvedValueOnce(undefined)
				.mockResolvedValue({ ...storedTrip, status: "active", startedAt: now });
			const started = await startReviewTrip(context, "trip");
			expect(started.status).toBe("active");
			expect(query).toHaveBeenCalledWith(
				expect.objectContaining({
					sql: expect.stringContaining("`started_at` = ?"),
				}),
				expect.arrayContaining([
					"2026-10-18 13:00:00.000",
					"2026-10-18 14:00:00.000",
				]),
			);
			const [position] = simulateDemoPositions(
				[
					{
						externalId: selectedVehicle.externalId,
						lastLat: null,
						lastLng: null,
						activeTrip: { ...storedTrip, createdAt: now },
					},
				],
				new Date(now.getTime() + MS_PER_SECOND),
			);
			expect(position?.lng).toBeGreaterThan(-77);
			expect(position?.lng).toBeLessThan(-76);
		} finally {
			vi.useRealTimers();
		}
	});
});
