import { createRequire } from "node:module";
import type {
	gpsConnection,
	TripStatus,
	trip,
	vehicle,
} from "@hack-the-andes-project/db/schema/fleet";
import { createRequestLogger } from "evlog";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { DEMO_TRIP_SCENARIOS } from "./constants";
import { generateEncryptionKeyBase64 } from "./crypto/index";
import { demoEntityId } from "./demo-fleet";
import { prepareDemo, restartFinishedDemo, wipeDemoFleet } from "./demo-seed";
import * as incidentLoading from "./fleet/load-alertable-incidents";
import * as demoPlanning from "./fleet/plan-demo-trip";
import * as fleetSync from "./fleet/sync-connection";
import { DEMO_VEHICLES } from "./providers/index";
import * as routing from "./routing/osrm";

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
const databaseRequire = createRequire(
	import.meta.resolve("@hack-the-andes-project/db"),
);
vi.doMock(databaseRequire.resolve("mysql2/promise"), () => ({
	default: {
		createConnection: vi.fn(async () => ({ config: {}, query, end: vi.fn() })),
	},
}));
const { createDb } = await import("@hack-the-andes-project/db");
const database = await createDb({
	host: "mock",
	port: Number.NaN,
	user: "mock",
	password: "mock",
	database: "mock",
});
const createdAt = new Date("2026-10-17T00:00:00Z");
const organizationId = "demo-organization";
interface StoredTrip {
	vehicleId: string;
	status: TripStatus;
}
const connectionIds = new Set<string>();
const vehicleIds = new Set<string>();
const storedTrips = new Map<string, StoredTrip>();
const route = {
	geometry: {
		type: "LineString",
		coordinates: [
			[-76, -12],
			[-75, -11],
		],
	},
	distanceM: 1000,
	durationS: 100,
} satisfies import("./hazards/types").RouteCandidate;
let connection: typeof gpsConnection.$inferSelect;
let vehicles: Array<typeof vehicle.$inferSelect>;

beforeEach(async () => {
	query.mockReset();
	connectionIds.clear();
	vehicleIds.clear();
	storedTrips.clear();
	connection = {
		id: await demoEntityId(organizationId, "connection"),
		organizationId,
		provider: "demo",
		label: "Flota demo",
		encryptedCredentials: "",
		status: "active",
		lastSyncAt: null,
		lastError: null,
		createdAt,
		updatedAt: createdAt,
	};
	vehicles = await Promise.all(
		DEMO_VEHICLES.map(async (demoVehicle) => ({
			id: await demoEntityId(
				organizationId,
				`vehicle:${connection.id}:${demoVehicle.externalId}`,
			),
			organizationId,
			connectionId: connection.id,
			externalId: demoVehicle.externalId,
			vehicleTypeId: null,
			axleCount: null,
			grossWeightKg: null,
			name: demoVehicle.name,
			plate: demoVehicle.plate,
			lastLat: demoVehicle.depot.lat,
			lastLng: demoVehicle.depot.lng,
			lastHeading: null,
			lastSpeedKmh: null,
			lastPositionAt: createdAt,
			active: true,
			createdAt,
			updatedAt: createdAt,
		})),
	);
	vi.spyOn(database.query.gpsConnection, "findFirst").mockImplementation(
		vi
			.fn()
			.mockImplementation(async () =>
				connectionIds.has(connection.id) ? connection : undefined,
			),
	);
	vi.spyOn(database.query.vehicle, "findMany").mockImplementation(
		vi
			.fn()
			.mockImplementation(async () =>
				vehicles.filter((storedVehicle) => vehicleIds.has(storedVehicle.id)),
			),
	);
	vi.spyOn(database.query.trip, "findFirst").mockImplementation(
		vi
			.fn()
			.mockImplementation(
				async (
					configuration: Parameters<typeof database.query.trip.findFirst>[0],
				) => {
					const tripId =
						configuration?.where && "id" in configuration.where
							? configuration.where.id
							: undefined;
					if (typeof tripId !== "string") return undefined;
					const storedTrip = storedTrips.get(tripId);
					if (!storedTrip) return undefined;
					return {
						id: tripId,
						vehicleId: storedTrip.vehicleId,
						organizationId,
						name: "Demo",
						originLat: 0,
						originLng: 0,
						destinationLat: 1,
						destinationLng: 1,
						destinationName: "Destino",
						routeGeometry: route.geometry,
						routeDistanceM: route.distanceM,
						routeDurationS: route.durationS,
						status: storedTrip.status,
						reviewId: null,
						chosenCandidateId: null,
						chosenCandidate: null,
						originPlaceId: null,
						destinationPlaceId: null,
						departureAt: null,
						startedAt: null,
						etaAt: null,
						lastEvaluatedAt: null,
						createdAt,
						updatedAt: createdAt,
					} satisfies typeof trip.$inferSelect;
				},
			),
	);
	vi.spyOn(database.query.trip, "findMany").mockImplementation(
		vi
			.fn()
			.mockImplementation(async () =>
				Array.from(storedTrips.values(), ({ status }) => ({ status })),
			),
	);
	query.mockImplementation(async (options, parameters) => {
		const statement = typeof options === "string" ? options : options.sql;
		if (statement.startsWith("insert into")) {
			const id = parameters?.[0];
			if (
				typeof id === "string" &&
				statement.includes("`hack_the_andes_gps_connection`")
			)
				connectionIds.add(id);
			if (statement.includes("`hack_the_andes_vehicle`")) {
				for (const storedVehicle of vehicles)
					if (parameters?.includes(storedVehicle.id))
						vehicleIds.add(storedVehicle.id);
			}
			if (
				typeof id === "string" &&
				statement.includes("`hack_the_andes_trip`")
			) {
				const vehicleId = parameters?.[2];
				if (typeof vehicleId === "string" && !storedTrips.has(id))
					storedTrips.set(id, { vehicleId, status: "active" });
			}
		}
		if (statement.startsWith("delete from `hack_the_andes_trip`")) {
			const deletedStatuses = statement.includes("`status` in")
				? parameters.slice(1)
				: null;
			let affectedRows = 0;
			for (const [tripId, { status }] of storedTrips) {
				if (deletedStatuses && !deletedStatuses.includes(status)) continue;
				storedTrips.delete(tripId);
				affectedRows += 1;
			}
			return [{ affectedRows }, []];
		}
		if (statement.startsWith("delete from `hack_the_andes_vehicle`"))
			vehicleIds.clear();
		if (statement.startsWith("delete from `hack_the_andes_gps_connection`"))
			connectionIds.clear();
		if (statement.startsWith("select count"))
			return [
				[
					[
						statement.includes("`hack_the_andes_vehicle`")
							? vehicleIds.size
							: storedTrips.size,
					],
				],
				[],
			];
		return [{ affectedRows: 1 }, []];
	});
	vi.spyOn(fleetSync, "syncConnection").mockResolvedValue({
		connectionId: connection.id,
		ok: true,
		vehiclesSynced: DEMO_VEHICLES.length,
		positionsInserted: DEMO_VEHICLES.length,
	});
	vi.spyOn(incidentLoading, "loadAlertableIncidents").mockResolvedValue([]);
	vi.spyOn(demoPlanning, "planDemoTrip").mockResolvedValue({
		destination: { lat: -11, lng: -75 },
		incident: null,
	});
	vi.spyOn(routing, "fetchRouteCandidates").mockResolvedValue([route]);
});

afterEach(() => vi.restoreAllMocks());
afterAll(async () => database.$client.end());

const input = {
	db: database,
	organizationId,
	encryptionKey: generateEncryptionKeyBase64(),
	osrmBaseUrl: "https://routing.example.com",
	log: createRequestLogger(),
};

function tripStatuses() {
	return Array.from(storedTrips.values(), ({ status }) => status);
}

function deleteStatements() {
	return query.mock.calls.flatMap(([options, parameters]) => {
		const table = options.sql.match(/^delete from `([^`]+)`/)?.[1];
		return table ? [{ table, parameters }] : [];
	});
}

async function finishDemoTrips() {
	for (const scenario of DEMO_TRIP_SCENARIOS) {
		const tripId = await demoEntityId(organizationId, `trip:${scenario}`);
		const storedTrip = storedTrips.get(tripId);
		if (storedTrip)
			storedTrips.set(tripId, {
				...storedTrip,
				status: scenario === "hazard" ? "completed" : "cancelled",
			});
	}
}

describe("shared demo seeding", () => {
	it("keeps one fleet and two trips across repeat calls", async () => {
		await expect(prepareDemo(input)).resolves.toEqual({
			vehicleCount: DEMO_VEHICLES.length,
			tripCount: 2,
		});
		await expect(prepareDemo(input)).resolves.toEqual({
			vehicleCount: DEMO_VEHICLES.length,
			tripCount: 2,
		});
		expect(connectionIds.size).toBe(1);
		expect(vehicleIds.size).toBe(DEMO_VEHICLES.length);
		expect(
			new Set(Array.from(storedTrips.values(), ({ vehicleId }) => vehicleId))
				.size,
		).toBe(2);
		expect(demoPlanning.planDemoTrip).toHaveBeenCalledTimes(2);
	});

	it("deduplicates simultaneous preparations with database upserts", async () => {
		await Promise.all([prepareDemo(input), prepareDemo(input)]);
		expect(connectionIds.size).toBe(1);
		expect(vehicleIds.size).toBe(DEMO_VEHICLES.length);
		expect(storedTrips.size).toBe(2);
		expect(
			new Set(Array.from(storedTrips.values(), ({ vehicleId }) => vehicleId))
				.size,
		).toBe(2);
		const insertQueries = vi
			.mocked(database.$client.query)
			.mock.calls.filter(
				([options]) =>
					typeof options !== "string" && options.sql.startsWith("insert into"),
			);
		for (const [options] of insertQueries)
			expect(typeof options !== "string" && options.sql).toContain(
				"on duplicate key update",
			);
	});

	it("only reads the connection, trips and counts on a seeded visit", async () => {
		await prepareDemo(input);
		query.mockClear();
		vi.mocked(database.query.gpsConnection.findFirst).mockClear();
		vi.mocked(database.query.vehicle.findMany).mockClear();
		vi.mocked(database.query.trip.findFirst).mockClear();
		vi.mocked(fleetSync.syncConnection).mockClear();
		vi.mocked(incidentLoading.loadAlertableIncidents).mockClear();
		vi.mocked(demoPlanning.planDemoTrip).mockClear();
		vi.mocked(routing.fetchRouteCandidates).mockClear();

		await expect(prepareDemo(input)).resolves.toEqual({
			vehicleCount: DEMO_VEHICLES.length,
			tripCount: 2,
		});

		expect(database.query.gpsConnection.findFirst).toHaveBeenCalledOnce();
		expect(database.query.trip.findFirst).toHaveBeenCalledTimes(2);
		expect(database.query.vehicle.findMany).not.toHaveBeenCalled();
		expect(fleetSync.syncConnection).not.toHaveBeenCalled();
		expect(incidentLoading.loadAlertableIncidents).not.toHaveBeenCalled();
		expect(demoPlanning.planDemoTrip).not.toHaveBeenCalled();
		expect(routing.fetchRouteCandidates).not.toHaveBeenCalled();
		expect(query).toHaveBeenCalledTimes(2);
		for (const [options] of query.mock.calls) {
			expect(options.sql).toMatch(/^select count/);
		}
	});

	it("retries missing trips without importing or syncing an existing fleet", async () => {
		vi.mocked(demoPlanning.planDemoTrip).mockRejectedValueOnce(
			new Error("OSRM unavailable"),
		);
		await prepareDemo(input);
		query.mockClear();
		vi.mocked(fleetSync.syncConnection).mockClear();

		await expect(prepareDemo(input)).resolves.toEqual({
			vehicleCount: DEMO_VEHICLES.length,
			tripCount: 2,
		});

		expect(fleetSync.syncConnection).not.toHaveBeenCalled();
		const fleetWrites = query.mock.calls.filter(([options]) =>
			/^insert into `hack_the_andes_(gps_connection|vehicle)`/.test(
				options.sql,
			),
		);
		expect(fleetWrites).toHaveLength(0);
	});

	it.each(["unavailable", "no-hazard"])(
		"preserves the fleet when planning is %s",
		async (failure) => {
			if (failure === "unavailable")
				vi.mocked(demoPlanning.planDemoTrip).mockRejectedValue(
					new Error("OSRM unavailable"),
				);
			else vi.mocked(demoPlanning.planDemoTrip).mockResolvedValue(null);
			await expect(prepareDemo(input)).resolves.toEqual({
				vehicleCount: DEMO_VEHICLES.length,
				tripCount: 0,
			});
			expect(connectionIds.size).toBe(1);
		},
	);

	it("wipes only the demo organization's fleet in dependency order", async () => {
		await wipeDemoFleet(database, organizationId);
		const deletes = deleteStatements();
		expect(deletes.map(({ table }) => table)).toEqual([
			"hack_the_andes_alert",
			"hack_the_andes_trip",
			"hack_the_andes_vehicle_position",
			"hack_the_andes_vehicle",
			"hack_the_andes_gps_connection",
		]);
		for (const deletion of deletes)
			expect(deletion.parameters).toContain(organizationId);
	});
});

describe("finished demo restart", () => {
	it("rebuilds a finished demo with a fresh fleet and new trips", async () => {
		await prepareDemo(input);
		await finishDemoTrips();
		query.mockClear();
		vi.mocked(fleetSync.syncConnection).mockClear();
		vi.mocked(demoPlanning.planDemoTrip).mockClear();
		const log = createRequestLogger();

		await expect(restartFinishedDemo({ ...input, log })).resolves.toEqual({
			vehicleCount: DEMO_VEHICLES.length,
			tripCount: 2,
		});

		const deletes = deleteStatements();
		expect(deletes.map(({ table }) => table)).toEqual([
			"hack_the_andes_alert",
			"hack_the_andes_trip",
			"hack_the_andes_alert",
			"hack_the_andes_trip",
			"hack_the_andes_vehicle_position",
			"hack_the_andes_vehicle",
			"hack_the_andes_gps_connection",
		]);
		for (const deletion of deletes)
			expect(deletion.parameters).toContain(organizationId);
		expect(connectionIds.size).toBe(1);
		expect(vehicleIds.size).toBe(DEMO_VEHICLES.length);
		expect(fleetSync.syncConnection).toHaveBeenCalledOnce();
		expect(demoPlanning.planDemoTrip).toHaveBeenCalledTimes(
			DEMO_TRIP_SCENARIOS.length,
		);
		expect(tripStatuses()).toEqual(["active", "active"]);
		expect(log.getContext()).toMatchObject({
			demo: {
				restarted: true,
				reason: "trips_finished",
				vehicleCount: DEMO_VEHICLES.length,
				tripCount: 2,
			},
		});

		query.mockClear();
		await expect(restartFinishedDemo(input)).resolves.toBeNull();
		expect(query).not.toHaveBeenCalled();
	});

	it.each<{ state: string; statuses: TripStatus[] }>([
		{ state: "a demo trip is still active", statuses: ["completed", "active"] },
		{
			state: "a trip a visitor planned is still active",
			statuses: ["completed", "cancelled", "active"],
		},
		{ state: "it has no trips yet", statuses: [] },
	])("leaves the demo alone while $state", async ({ statuses }) => {
		for (const [index, status] of statuses.entries())
			storedTrips.set(`trip-${index}`, { vehicleId: "demo-vehicle", status });

		await expect(restartFinishedDemo(input)).resolves.toBeNull();

		expect(query).not.toHaveBeenCalled();
		expect(demoPlanning.planDemoTrip).not.toHaveBeenCalled();
		expect(tripStatuses()).toEqual(statuses);
	});

	it("restarts only once when two restarts race", async () => {
		await prepareDemo(input);
		await finishDemoTrips();
		query.mockClear();
		vi.mocked(demoPlanning.planDemoTrip).mockClear();
		const cronLog = createRequestLogger();
		const visitLog = createRequestLogger();

		const restarts = await Promise.all([
			restartFinishedDemo({ ...input, log: cronLog }),
			restartFinishedDemo({ ...input, log: visitLog }),
		]);

		expect(restarts.filter((restart) => restart === null)).toHaveLength(1);
		expect(restarts).toContainEqual({
			vehicleCount: DEMO_VEHICLES.length,
			tripCount: 2,
		});
		expect([cronLog.getContext(), visitLog.getContext()]).toContainEqual(
			expect.objectContaining({
				demo: { restarted: false, reason: "concurrent_restart" },
			}),
		);
		expect(
			deleteStatements().filter(
				({ table }) => table === "hack_the_andes_gps_connection",
			),
		).toHaveLength(1);
		expect(demoPlanning.planDemoTrip).toHaveBeenCalledTimes(
			DEMO_TRIP_SCENARIOS.length,
		);
		expect(connectionIds.size).toBe(1);
		expect(vehicleIds.size).toBe(DEMO_VEHICLES.length);
		expect(tripStatuses()).toEqual(["active", "active"]);
	});

	it("leaves rebuilt trips running when its finished check went stale", async () => {
		await prepareDemo(input);
		vi.mocked(database.query.trip.findMany).mockImplementationOnce(
			vi
				.fn()
				.mockResolvedValue([{ status: "completed" }, { status: "cancelled" }]),
		);
		query.mockClear();
		vi.mocked(demoPlanning.planDemoTrip).mockClear();

		await expect(restartFinishedDemo(input)).resolves.toBeNull();

		expect(deleteStatements().map(({ table }) => table)).toEqual([
			"hack_the_andes_alert",
			"hack_the_andes_trip",
		]);
		expect(demoPlanning.planDemoTrip).not.toHaveBeenCalled();
		expect(connectionIds.size).toBe(1);
		expect(vehicleIds.size).toBe(DEMO_VEHICLES.length);
		expect(tripStatuses()).toEqual(["active", "active"]);
	});
});
