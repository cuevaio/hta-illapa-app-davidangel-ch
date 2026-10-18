import { createDb } from "@hack-the-andes-project/db";
import type {
	gpsConnection,
	trip,
	vehicle,
} from "@hack-the-andes-project/db/schema/fleet";
import { createLogger } from "evlog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	MS_PER_SECOND,
	POSITION_RETENTION_BATCH_SIZE_ROWS,
	POSITION_RETENTION_MS,
} from "../constants";
import { encryptJson, generateEncryptionKeyBase64 } from "../crypto/index";
import {
	CARRETERA_CENTRAL,
	HUANCAYO,
	LIMA,
	LIMA_HUANCAYO_ROUTE,
	MATUCANA,
	pointIncident,
} from "../hazards/test-fixtures";
import type { RouteCandidate } from "../hazards/types";
import { DEMO_VEHICLES } from "../providers/constants";
import { type DemoTrip, simulateDemoPositions } from "../providers/demo";
import { evaluateTrip } from "./evaluate-trip";
import { pruneVehiclePositions } from "./prune-positions";
import { resolveObsoleteAlerts } from "./resolve-obsolete-alerts";
import { syncConnection } from "./sync-connection";

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

const now = new Date("2026-10-17T12:02:00Z");
const recordedAt = new Date("2026-10-17T12:00:00Z");
const connection: typeof gpsConnection.$inferSelect = {
	id: "connection",
	organizationId: "organization",
	provider: "samsara",
	label: "Flota",
	encryptedCredentials: "",
	status: "active",
	lastSyncAt: null,
	lastError: null,
	createdAt: recordedAt,
	updatedAt: recordedAt,
};
const storedVehicle: typeof vehicle.$inferSelect = {
	id: "vehicle",
	organizationId: connection.organizationId,
	connectionId: connection.id,
	externalId: "external-truck",
	vehicleTypeId: null,
	axleCount: null,
	grossWeightKg: null,
	name: "Camión",
	plate: "ABC-123",
	lastLat: LIMA[1],
	lastLng: LIMA[0],
	lastHeading: null,
	lastSpeedKmh: 60,
	lastPositionAt: recordedAt,
	active: true,
	createdAt: recordedAt,
	updatedAt: recordedAt,
};
const activeTrip: typeof trip.$inferSelect = {
	reviewId: null,
	chosenCandidateId: null,
	chosenCandidate: null,
	originPlaceId: null,
	destinationPlaceId: null,
	departureAt: null,
	startedAt: null,
	id: "trip",
	organizationId: connection.organizationId,
	vehicleId: storedVehicle.id,
	name: "Lima a Huancayo",
	originLat: LIMA[1],
	originLng: LIMA[0],
	destinationLat: HUANCAYO[1],
	destinationLng: HUANCAYO[0],
	destinationName: "Huancayo",
	routeGeometry: CARRETERA_CENTRAL,
	routeDistanceM: LIMA_HUANCAYO_ROUTE.distanceM,
	routeDurationS: LIMA_HUANCAYO_ROUTE.durationS,
	status: "active",
	etaAt: null,
	lastEvaluatedAt: null,
	createdAt: recordedAt,
	updatedAt: recordedAt,
};

function driverValue(value: unknown) {
	if (value instanceof Date)
		return value.toISOString().replace("T", " ").replace("Z", "");
	return typeof value === "boolean" ? Number(value) : value;
}

async function testDatabase() {
	return createDb({
		host: "test",
		port: 0,
		user: "test",
		password: "test",
		database: "test",
	});
}

beforeEach(() => {
	query.mockReset();
	query.mockImplementation(async (options) => [
		options.rowsAsArray ? [] : { affectedRows: 1 },
		[],
	]);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("syncConnection with real Drizzle queries", () => {
	it("writes history before the position checkpoint and preserves IDs across retries", async () => {
		const encryptionKey = generateEncryptionKeyBase64();
		const encryptedCredentials = await encryptJson(encryptionKey, {
			provider: "samsara",
			apiToken: "secret-token",
		});
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async (input) =>
				Response.json({
					data: String(input).includes("/stats")
						? [
								{
									id: storedVehicle.externalId,
									gps: {
										time: now.toISOString(),
										latitude: MATUCANA[1],
										longitude: MATUCANA[0],
									},
								},
							]
						: [
								{
									id: storedVehicle.externalId,
									name: storedVehicle.name,
									licensePlate: storedVehicle.plate,
								},
							],
				}),
			),
		);
		let failCheckpoint = true;
		query.mockImplementation(async (options) => {
			if (options.rowsAsArray) {
				return [[Object.values(storedVehicle).map(driverValue)], []];
			}
			if (options.sql.includes("if(") && failCheckpoint) {
				failCheckpoint = false;
				throw new Error("checkpoint unavailable");
			}
			return [{ affectedRows: 1 }, []];
		});
		const db = await testDatabase();
		const input = {
			db,
			encryptionKey,
			connection: { ...connection, encryptedCredentials },
			now,
			log: createLogger(),
		};
		expect((await syncConnection(input)).ok).toBe(false);
		expect(await syncConnection(input)).toMatchObject({
			ok: true,
			vehiclesSynced: 1,
			positionsInserted: 1,
		});
		const historyWrites = query.mock.calls.filter(([options]) =>
			options.sql.startsWith("insert into `hack_the_andes_vehicle_position`"),
		);
		expect(historyWrites).toHaveLength(2);
		expect(historyWrites[0]?.[1][0]).toBe(historyWrites[1]?.[1][0]);
		const firstHistoryIndex = query.mock.calls.findIndex(([options]) =>
			options.sql.includes("insert into `hack_the_andes_vehicle_position`"),
		);
		const firstCheckpointIndex = query.mock.calls.findIndex(([options]) =>
			options.sql.includes("if("),
		);
		expect(firstHistoryIndex).toBeLessThan(firstCheckpointIndex);
		const checkpointSql = query.mock.calls[firstCheckpointIndex]?.[0].sql;
		expect(checkpointSql).toContain(
			"values(`last_position_at`) > `hack_the_andes_vehicle`.`last_position_at`",
		);
		expect(JSON.stringify(query.mock.calls)).not.toContain("secret-token");
	});

	it("backfills missing demo profile values without replacing stored profiles", async () => {
		const encryptionKey = generateEncryptionKeyBase64();
		const encryptedCredentials = await encryptJson(encryptionKey, {
			provider: "demo",
		});
		expect(
			await syncConnection({
				db: await testDatabase(),
				encryptionKey,
				connection: { ...connection, provider: "demo", encryptedCredentials },
				now,
				log: createLogger(),
			}),
		).toMatchObject({ ok: true, vehiclesSynced: DEMO_VEHICLES.length });
		const vehicleWrite = query.mock.calls.find(([options]) =>
			options.sql.startsWith("insert into `hack_the_andes_vehicle`"),
		);
		expect(vehicleWrite?.[1]).toEqual(
			expect.arrayContaining(["t2s3", 5, 43_000, "t3s3", 6, 48_000]),
		);
		for (const column of ["vehicle_type_id", "axle_count", "gross_weight_kg"]) {
			expect(vehicleWrite?.[0].sql).toContain(
				`coalesce(\`hack_the_andes_vehicle\`.\`${column}\`, values(\`${column}\`))`,
			);
		}
	});

	it("records a safe failure without exposing a provider error containing credentials", async () => {
		const encryptionKey = generateEncryptionKeyBase64();
		const encryptedCredentials = await encryptJson(encryptionKey, {
			provider: "samsara",
			apiToken: "private-token",
		});
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async () => {
				throw new Error("provider echoed private-token");
			}),
		);
		const log = createLogger();
		const logged = vi.spyOn(log, "set");
		const level = vi.spyOn(log, "setLevel");
		const result = await syncConnection({
			db: await testDatabase(),
			encryptionKey,
			connection: { ...connection, encryptedCredentials },
			now,
			log,
		});
		expect(result.ok).toBe(false);
		expect(query.mock.calls[0]?.[1]).toContain("error");
		expect(
			JSON.stringify([result, query.mock.calls, logged.mock.calls]),
		).not.toContain("private-token");
		expect(level).toHaveBeenCalledWith("error");
	});

	it("moves a demo truck along its active trip without contacting a provider", async () => {
		const encryptionKey = generateEncryptionKeyBase64();
		const encryptedCredentials = await encryptJson(encryptionKey, {
			provider: "demo",
		});
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal("fetch", fetchMock);
		const demoVehicle = { ...storedVehicle, externalId: "demo-callao" };
		const demoTrip: DemoTrip = {
			routeGeometry: CARRETERA_CENTRAL,
			routeDistanceM: LIMA_HUANCAYO_ROUTE.distanceM,
			routeDurationS: LIMA_HUANCAYO_ROUTE.durationS,
			destinationLat: HUANCAYO[1],
			destinationLng: HUANCAYO[0],
			createdAt: new Date(now.getTime() - 600 * MS_PER_SECOND),
		};
		query.mockImplementation(async (options) => {
			if (!options.rowsAsArray) return [{ affectedRows: 1 }, []];
			if (options.sql.includes("left join")) {
				return [
					[
						[
							demoVehicle.externalId,
							demoVehicle.lastLat,
							demoVehicle.lastLng,
							...Object.values(demoTrip).map(driverValue),
						],
					],
					[],
				];
			}
			return [[Object.values(demoVehicle).map(driverValue)], []];
		});
		const result = await syncConnection({
			db: await testDatabase(),
			encryptionKey,
			connection: { ...connection, provider: "demo", encryptedCredentials },
			now,
			log: createLogger(),
		});
		expect(result).toMatchObject({
			ok: true,
			vehiclesSynced: DEMO_VEHICLES.length,
			positionsInserted: 1,
		});
		expect(fetchMock).not.toHaveBeenCalled();
		const fleetQuery = query.mock.calls.find(([options]) =>
			options.sql.includes("left join"),
		);
		expect(fleetQuery?.[0].sql).toContain(
			"coalesce(`hack_the_andes_trip`.`started_at`, `hack_the_andes_trip`.`created_at`)",
		);
		expect(fleetQuery?.[1]).toEqual(
			expect.arrayContaining(["active", connection.id]),
		);
		const [expectedPosition] = simulateDemoPositions(
			[
				{
					externalId: demoVehicle.externalId,
					lastLat: demoVehicle.lastLat,
					lastLng: demoVehicle.lastLng,
					activeTrip: demoTrip,
				},
			],
			now,
		);
		const historyWrite = query.mock.calls.find(([options]) =>
			options.sql.startsWith("insert into `hack_the_andes_vehicle_position`"),
		);
		expect(historyWrite?.[1]).toEqual(
			expect.arrayContaining([
				expectedPosition?.lat,
				expectedPosition?.lng,
				expectedPosition?.speedKmh,
			]),
		);
		expect(expectedPosition?.lat).not.toBe(demoVehicle.lastLat);
	});
});

describe("evaluateTrip with real Drizzle queries", () => {
	it("completes an arrival and resolves open and acknowledged alerts", async () => {
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal("fetch", fetchMock);
		const result = await evaluateTrip({
			db: await testDatabase(),
			osrmBaseUrl: "https://osrm.test",
			trip: activeTrip,
			vehicle: { ...storedVehicle, lastLat: HUANCAYO[1], lastLng: HUANCAYO[0] },
			incidents: [],
			now,
			log: createLogger(),
		});
		expect(result).toMatchObject({
			ok: true,
			completed: true,
			alertsResolved: 1,
		});
		expect(query.mock.calls[0]?.[1]).toEqual(
			expect.arrayContaining([
				"open",
				"acknowledged",
				activeTrip.organizationId,
			]),
		);
		expect(query.mock.calls[1]?.[1]).toContain("completed");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("persists hazard alerts when OSRM is unavailable", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async () => {
				throw new Error("OSRM unavailable");
			}),
		);
		const hazard = pointIncident("huaico", MATUCANA, {
			title: "Huaico en PE-22",
		});
		const result = await evaluateTrip({
			db: await testDatabase(),
			osrmBaseUrl: "https://osrm.test",
			trip: activeTrip,
			vehicle: storedVehicle,
			incidents: [hazard],
			now,
			log: createLogger(),
		});
		expect(result).toMatchObject({
			ok: false,
			completed: false,
			alertsCreated: 1,
			error: "No se pudo consultar una ruta alternativa.",
		});
		const alertWrite = query.mock.calls.find(([options]) =>
			options.sql.startsWith("insert into `hack_the_andes_alert`"),
		);
		expect(alertWrite?.[1]).toContain("open");
		expect(alertWrite?.[1]).toContain(null);
		expect(alertWrite?.[0].sql.split("on duplicate key update")[1]).not.toMatch(
			/alternative_route|acknowledged_at/,
		);
		expect(query.mock.calls.at(-1)?.[0].sql).toContain("not in");
		expect(query.mock.calls.at(-1)?.[1]).toContain(hazard.id);
	});

	it("uses supplied route candidates for a new alert without another OSRM request", async () => {
		const hazard = pointIncident("huaico", MATUCANA);
		const alternativeRoute: RouteCandidate = {
			...LIMA_HUANCAYO_ROUTE,
			geometry: { type: "LineString", coordinates: [LIMA, HUANCAYO] },
		};
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal("fetch", fetchMock);
		const result = await evaluateTrip({
			db: await testDatabase(),
			osrmBaseUrl: "https://osrm.test",
			trip: activeTrip,
			vehicle: storedVehicle,
			incidents: [hazard],
			routeCandidates: [LIMA_HUANCAYO_ROUTE, alternativeRoute],
			now,
			log: createLogger(),
		});
		expect(result).toMatchObject({
			ok: true,
			alertsCreated: 1,
			alertsUpdated: 0,
		});
		expect(fetchMock).not.toHaveBeenCalled();
		const alertWrite = query.mock.calls.find(([options]) =>
			options.sql.startsWith("insert into `hack_the_andes_alert`"),
		);
		expect(alertWrite?.[1]).toEqual(
			expect.arrayContaining([hazard.id, JSON.stringify(alternativeRoute)]),
		);
	});

	it("refreshes an existing alert without fetching another alternative", async () => {
		const hazard = pointIncident("existing-huaico", MATUCANA);
		query.mockImplementation(async (options) => [
			options.rowsAsArray ? [[hazard.id]] : { affectedRows: 1 },
			[],
		]);
		const fetchMock = vi.fn<typeof fetch>();
		vi.stubGlobal("fetch", fetchMock);
		const result = await evaluateTrip({
			db: await testDatabase(),
			osrmBaseUrl: "https://osrm.test",
			trip: activeTrip,
			vehicle: storedVehicle,
			incidents: [hazard],
			now,
			log: createLogger(),
		});
		expect(result).toMatchObject({
			ok: true,
			alertsCreated: 0,
			alertsUpdated: 1,
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("reopens resolved alerts while preserving open and acknowledged status", async () => {
		const hazard = pointIncident("returning-huaico", MATUCANA);
		query.mockImplementation(async (options) => [
			options.rowsAsArray ? [[hazard.id]] : { affectedRows: 1 },
			[],
		]);
		const result = await evaluateTrip({
			db: await testDatabase(),
			osrmBaseUrl: "https://osrm.test",
			trip: activeTrip,
			vehicle: storedVehicle,
			incidents: [hazard],
			now,
			log: createLogger(),
		});
		expect(result).toMatchObject({ ok: true, alertsUpdated: 1 });
		const alertWrite = query.mock.calls.find(([options]) =>
			options.sql.startsWith("insert into `hack_the_andes_alert`"),
		);
		const updateSql = alertWrite?.[0].sql.split("on duplicate key update")[1];
		expect(updateSql).toContain(
			"`status` = if(`hack_the_andes_alert`.`status` = 'resolved', 'open', `hack_the_andes_alert`.`status`)",
		);
		expect(updateSql).toContain("`resolved_at` = ?");
		expect(alertWrite?.[1].at(-1)).toBeNull();
		expect(updateSql).not.toMatch(/alternative_route|acknowledged_at/);
	});

	it("stores a replacement route from the current GPS position", async () => {
		const offRouteVehicle = {
			...storedVehicle,
			lastLng: MATUCANA[0],
			lastLat: MATUCANA[1] - 0.05,
		};
		const replacementGeometry = {
			type: "LineString",
			coordinates: [
				[offRouteVehicle.lastLng, offRouteVehicle.lastLat],
				HUANCAYO,
			],
		};
		const fetchMock = vi.fn<typeof fetch>(async () =>
			Response.json({
				code: "Ok",
				routes: [
					{
						geometry: replacementGeometry,
						distance: 150_000,
						duration: 10_000,
					},
				],
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const result = await evaluateTrip({
			db: await testDatabase(),
			osrmBaseUrl: "https://osrm.test",
			trip: activeTrip,
			vehicle: offRouteVehicle,
			incidents: [],
			now,
			log: createLogger(),
		});
		expect(result).toMatchObject({
			ok: true,
			rerouted: true,
			completed: false,
		});
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
			`${offRouteVehicle.lastLng},${offRouteVehicle.lastLat};${HUANCAYO[0]},${HUANCAYO[1]}`,
		);
		expect(query.mock.calls[0]?.[1]).toContain(
			JSON.stringify(replacementGeometry),
		);
		expect(query.mock.calls[0]?.[0].sql).toContain("eta_at");
	});

	it("never evaluates or alerts on a planned trip", async () => {
		const result = await evaluateTrip({
			db: await testDatabase(),
			osrmBaseUrl: "https://osrm.test",
			trip: { ...activeTrip, status: "planned" },
			vehicle: storedVehicle,
			incidents: [],
			now,
			log: createLogger(),
		});
		expect(result).toMatchObject({ ok: true, skipped: "inactive_trip" });
		expect(query).not.toHaveBeenCalled();
	});

	it("skips a vehicle with no position without writing or resolving alerts", async () => {
		const result = await evaluateTrip({
			db: await testDatabase(),
			osrmBaseUrl: "https://osrm.test",
			trip: activeTrip,
			vehicle: { ...storedVehicle, lastPositionAt: null },
			incidents: [],
			now,
			log: createLogger(),
		});
		expect(result).toMatchObject({ ok: true, skipped: "no_position" });
		expect(query).not.toHaveBeenCalled();
	});
});

it("resolves obsolete alerts for ended trips and inactive or no longer alertable incidents within the tenant", async () => {
	await resolveObsoleteAlerts({
		db: await testDatabase(),
		now,
		organizationId: connection.organizationId,
	});
	const resolution = query.mock.calls[0];
	expect(resolution?.[0].sql).toContain("not exists");
	expect(resolution?.[0].sql).toContain(
		"`hack_the_andes_trip`.`organization_id` = `hack_the_andes_alert`.`organization_id`",
	);
	expect(resolution?.[0].sql).toContain("`hack_the_andes_incident`.`active`");
	expect(resolution?.[1]).toEqual(
		expect.arrayContaining([
			"resolved",
			"open",
			"acknowledged",
			"active",
			"road_accident",
			"warning",
			"critical",
			connection.organizationId,
		]),
	);
	expect(resolution?.[0].sql).toContain(
		"`hack_the_andes_incident`.`severity` in",
	);
});

it("resolves acknowledged alerts after passing the hazard", async () => {
	await evaluateTrip({
		db: await testDatabase(),
		osrmBaseUrl: "https://osrm.test",
		trip: activeTrip,
		vehicle: storedVehicle,
		incidents: [],
		now,
		log: createLogger(),
	});
	const resolution = query.mock.calls.at(-1);
	expect(resolution?.[1]).toEqual(
		expect.arrayContaining([
			"resolved",
			"open",
			"acknowledged",
			activeTrip.id,
			activeTrip.organizationId,
		]),
	);
});

it("does not complete at a snapped route endpoint far from the requested destination", async () => {
	const result = await evaluateTrip({
		db: await testDatabase(),
		osrmBaseUrl: "https://osrm.test",
		trip: { ...activeTrip, destinationLat: HUANCAYO[1] + 0.02 },
		vehicle: { ...storedVehicle, lastLat: HUANCAYO[1], lastLng: HUANCAYO[0] },
		incidents: [],
		now,
		log: createLogger(),
	});
	expect(result).toMatchObject({ ok: true, completed: false });
	expect(
		query.mock.calls.some(([, parameters]) => parameters.includes("completed")),
	).toBe(false);
});

it("completes within the destination radius even when the route doubles back", async () => {
	const result = await evaluateTrip({
		db: await testDatabase(),
		osrmBaseUrl: "https://osrm.test",
		trip: {
			...activeTrip,
			destinationLat: LIMA[1] + 0.001,
			destinationLng: LIMA[0],
		},
		vehicle: storedVehicle,
		incidents: [],
		now,
		log: createLogger(),
	});
	expect(result).toMatchObject({ ok: true, completed: true });
});

it("prunes expired position history in a bounded batch without deleting vehicle checkpoints", async () => {
	expect(await pruneVehiclePositions(await testDatabase(), now)).toBe(1);
	expect(query.mock.calls).toHaveLength(1);
	const deletion = query.mock.calls[0];
	expect(deletion?.[0].sql).toContain(
		"delete from `hack_the_andes_vehicle_position`",
	);
	expect(deletion?.[0].sql).toContain("`recorded_at` < ? limit ?");
	expect(deletion?.[1]).toEqual([
		new Date(now.getTime() - POSITION_RETENTION_MS)
			.toISOString()
			.replace("T", " ")
			.replace("Z", ""),
		POSITION_RETENTION_BATCH_SIZE_ROWS,
	]);
});

it("batches hazard upserts while preserving acknowledgement timestamps", async () => {
	const hazards = Array.from({ length: 251 }, (_, index) =>
		pointIncident(`hazard-${index}`, MATUCANA),
	);
	query.mockImplementation(async (options) => [
		options.rowsAsArray
			? hazards.map((hazard) => [hazard.id])
			: { affectedRows: 1 },
		[],
	]);
	const result = await evaluateTrip({
		db: await testDatabase(),
		osrmBaseUrl: "https://osrm.test",
		trip: activeTrip,
		vehicle: storedVehicle,
		incidents: hazards,
		now,
		log: createLogger(),
	});
	const writes = query.mock.calls.filter(([options]) =>
		options.sql.startsWith("insert into `hack_the_andes_alert`"),
	);
	expect(writes).toHaveLength(2);
	expect(result).toMatchObject({
		ok: true,
		alertsUpdated: 251,
		alertsCreated: 0,
	});
	expect(writes[0]?.[0].sql.split("on duplicate key update")[1]).not.toMatch(
		/acknowledged_at/,
	);
});
