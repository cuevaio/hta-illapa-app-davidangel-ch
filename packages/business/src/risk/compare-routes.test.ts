import { createDb } from "@hack-the-andes-project/db";
import type { LineString } from "geojson";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HUANCAYO, LA_OROYA, LIMA, TICLIO } from "../hazards/test-fixtures";
import {
	closedEdgeIds,
	compareRiskAwareRoutes,
	routingBounds,
} from "./compare-routes";

interface QueryOptions {
	sql: string;
	rowsAsArray: boolean;
}

const query = vi.hoisted(() =>
	vi.fn<
		(
			options: QueryOptions,
			parameters: unknown[],
		) => Promise<[unknown, unknown[]]>
	>(),
);

vi.mock("mysql2/promise", async (importOriginal) => ({
	...(await importOriginal<object>()),
	default: { createConnection: async () => ({ config: {}, query }) },
}));

function point([lng, lat]: [number, number]) {
	return { lat, lng };
}

beforeEach(() => {
	query.mockReset();
	query.mockImplementation(async () => [[], []]);
});

describe("routingBounds", () => {
	it("keeps Ticlio and La Oroya when Lima and Huancayo share a latitude", () => {
		const bounds = routingBounds(point(LIMA), point(HUANCAYO));

		for (const [lng, lat] of [TICLIO, LA_OROYA]) {
			expect(lat).toBeLessThanOrEqual(bounds.north);
			expect(lat).toBeGreaterThanOrEqual(bounds.south);
			expect(lng).toBeGreaterThanOrEqual(bounds.west);
			expect(lng).toBeLessThanOrEqual(bounds.east);
		}
	});

	it("keeps the minimum margin around short trips", () => {
		const bounds = routingBounds(
			{ lat: -12, lng: -77 },
			{ lat: -12.01, lng: -77.01 },
		);

		expect(bounds.north).toBeCloseTo(-11.7);
		expect(bounds.west).toBeCloseTo(-77.31);
	});
});

describe("closedEdgeIds", () => {
	// Two parallel streets ~110 m apart, both within the closure radius.
	const carreteraCentral: LineString = {
		type: "LineString",
		coordinates: [
			[-76.39, -11.844],
			[-76.38, -11.844],
		],
	};
	const parallelStreet: LineString = {
		type: "LineString",
		coordinates: [
			[-76.39, -11.845],
			[-76.38, -11.845],
		],
	};
	const closure = {
		id: "closure",
		title: "Huaico en Matucana",
		roadCode: "PE-22",
		lat: -11.844,
		lng: -76.385,
	};

	it("blocks the closed road but not a nearby road with another code", () => {
		expect(
			closedEdgeIds(
				[
					{
						id: "pe22",
						roadCode: "PE-22",
						lat: -11.844,
						lng: -76.385,
						geometry: carreteraCentral,
					},
					{
						id: "local",
						roadCode: "LM-115",
						lat: -11.845,
						lng: -76.385,
						geometry: parallelStreet,
					},
				],
				[closure],
			),
		).toEqual(new Set(["pe22"]));
	});

	it("blocks uncoded edges near a coded closure", () => {
		expect(
			closedEdgeIds(
				[
					{
						id: "untagged",
						roadCode: null,
						lat: -11.844,
						lng: -76.385,
						geometry: carreteraCentral,
					},
				],
				[closure],
			),
		).toEqual(new Set(["untagged"]));
	});

	it("blocks every nearby edge when the closure has no road code", () => {
		expect(
			closedEdgeIds(
				[
					{
						id: "pe22",
						roadCode: "PE-22",
						lat: -11.844,
						lng: -76.385,
						geometry: carreteraCentral,
					},
					{
						id: "local",
						roadCode: "LM-115",
						lat: -11.845,
						lng: -76.385,
						geometry: parallelStreet,
					},
				],
				[{ ...closure, roadCode: null }],
			),
		).toEqual(new Set(["pe22", "local"]));
	});

	it("ignores edges beyond the closure radius", () => {
		expect(
			closedEdgeIds(
				[
					{
						id: "pe22",
						roadCode: "PE-22",
						lat: -11.844,
						lng: -76.385,
						geometry: carreteraCentral,
					},
				],
				[{ ...closure, lat: -11.86 }],
			),
		).toEqual(new Set());
	});
});

describe("compareRiskAwareRoutes", () => {
	it("only reads assessments that are still valid", async () => {
		const db = await createDb({
			host: "test",
			port: 0,
			user: "test",
			password: "test",
			database: "test",
		});
		const now = new Date("2026-10-18T12:00:00Z");

		await compareRiskAwareRoutes({
			db,
			origin: point(LIMA),
			destination: point(HUANCAYO),
			horizonHours: 24,
			now,
		});

		const assessmentQuery = query.mock.calls.find(([options]) =>
			options.sql.includes("segment_risk_assessment"),
		);
		expect(assessmentQuery?.[0].sql).toMatch(/`valid_until` > \?/);
		// The mysql dialect binds timestamps as UTC "YYYY-MM-DD HH:MM:SS.mmm".
		expect(assessmentQuery?.[1]).toContain("2026-10-18 12:00:00.000");
	});
});
