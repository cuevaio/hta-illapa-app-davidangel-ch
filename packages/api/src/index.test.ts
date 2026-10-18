import { createRequire } from "node:module";
import { generateEncryptionKeyBase64 } from "@hack-the-andes-project/business/crypto/index";
import { DEMO_ACCOUNT_EMAIL } from "@hack-the-andes-project/business/demo-account";
import * as demoSeeding from "@hack-the-andes-project/business/demo-seed";
import * as incidentLoading from "@hack-the-andes-project/business/fleet/load-alertable-incidents";
import * as demoTripPlanning from "@hack-the-andes-project/business/fleet/plan-demo-trip";
import * as fleetSync from "@hack-the-andes-project/business/fleet/sync-connection";
import type {
	HazardIncident,
	RouteCandidate,
} from "@hack-the-andes-project/business/hazards/types";
import {
	DEMO_VEHICLES,
	samsaraProvider,
} from "@hack-the-andes-project/business/providers/index";
import * as riskRoutes from "@hack-the-andes-project/business/risk/compare-routes";
import * as routeReviewEvaluation from "@hack-the-andes-project/business/route-review/evaluate";
import { ROUTE_REVIEW_PLACES } from "@hack-the-andes-project/business/route-review/places";
import * as routing from "@hack-the-andes-project/business/routing/osrm";
import type { vehicle } from "@hack-the-andes-project/db/schema/fleet";
import { call, createRouterClient } from "@orpc/server";
import { createRequestLogger } from "evlog";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	expectTypeOf,
	it,
	vi,
} from "vitest";

import {
	ALERT_STATUS_OPEN,
	CREDENTIALS_VALIDATION_FAILED_MESSAGE,
	DEMO_VEHICLE_REQUIRED_MESSAGE,
	RISK_DISCLAIMER_MESSAGE,
	ROUTING_FAILED_MESSAGE,
	VEHICLE_POSITION_REQUIRED_MESSAGE,
} from "./constants";
import type { Context } from "./context";
import { resetDemo } from "./demo-reset";
import { organizationProcedure, protectedProcedure } from "./index";
import { appRouter } from "./routers/index";

const databaseRequire = createRequire(
	import.meta.resolve("@hack-the-andes-project/db"),
);
vi.doMock(databaseRequire.resolve("mysql2/promise"), () => ({
	default: {
		createConnection: vi.fn(async () => ({
			config: {},
			query: vi.fn(),
			end: vi.fn(),
		})),
	},
}));

const { createDb } = await import("@hack-the-andes-project/db");
const { createAuth } = await import("@hack-the-andes-project/auth");
const database = await createDb({
	host: "mock",
	port: Number.NaN,
	user: "mock",
	password: "mock",
	database: "mock",
});
const auth = createAuth(
	{
		BETTER_AUTH_URL: "https://api.example.com",
		BETTER_AUTH_SECRET: "test-secret-for-organization-procedure",
		ALLOWED_ORIGINS: "https://app.example.com",
		CLIENT_IP_HEADER: "cf-connecting-ip",
	},
	database,
);
const createdAt = new Date("2026-10-17T00:00:00.000Z");
const session = {
	user: {
		id: "fleet-owner",
		name: "Fleet Owner",
		email: "owner@example.com",
		emailVerified: true,
		createdAt,
		updatedAt: createdAt,
	},
	session: {
		id: "session",
		userId: "fleet-owner",
		token: "session-token",
		createdAt,
		updatedAt: createdAt,
		expiresAt: new Date("2026-10-18T00:00:00.000Z"),
		activeOrganizationId: "selected-organization",
	},
};

function contextFor(session: Context["session"]): Context {
	return {
		db: database,
		auth,
		log: createRequestLogger(),
		session,
		encryptionKey: "unused-in-middleware-tests",
		osrmBaseUrl: "https://routing.example.com",
		waitUntil: (promise) => void promise,
	};
}

const procedure = organizationProcedure.handler(({ context }) => {
	expectTypeOf(context.organizationId).toEqualTypeOf<string>();
	expectTypeOf(context.session).toEqualTypeOf<
		NonNullable<Context["session"]>
	>();
	return context.organizationId;
});

beforeEach(() => {
	vi.spyOn(database.query.member, "findFirst").mockResolvedValue({
		id: "membership",
		organizationId: session.session.activeOrganizationId,
		userId: session.user.id,
		role: "owner",
		createdAt,
	});
});

afterAll(async () => {
	await database.$client.end();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("organizationProcedure", () => {
	it("rejects an unauthenticated request", async () => {
		await expect(
			call(procedure, undefined, { context: contextFor(null) }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it.each([null, undefined, ""])(
		"rejects an authenticated session without an active organization (%s)",
		async (activeOrganizationId) => {
			await expect(
				call(procedure, undefined, {
					context: contextFor({
						...session,
						session: { ...session.session, activeOrganizationId },
					}),
				}),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
		},
	);

	it("rejects a removed member even when the cached session still selects the organization", async () => {
		const findMembership = vi
			.spyOn(database.query.member, "findFirst")
			.mockResolvedValue(undefined);
		await expect(
			call(procedure, undefined, { context: contextFor(session) }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(findMembership).toHaveBeenCalledWith({
			columns: { id: true },
			where: {
				organizationId: session.session.activeOrganizationId,
				userId: session.user.id,
			},
		});
	});

	it("passes the selected organization to downstream handlers", async () => {
		await expect(
			call(procedure, undefined, { context: contextFor(session) }),
		).resolves.toBe(session.session.activeOrganizationId);
	});
});

describe("fleet procedure boundaries", () => {
	const fleetRouters: Array<
		keyof Pick<
			typeof appRouter,
			"connections" | "vehicles" | "trips" | "alerts"
		>
	> = ["connections", "vehicles", "trips", "alerts"];
	const tripInput = {
		vehicleId: "fleet-vehicle",
		name: "Delivery",
		destination: { lat: 0, lng: 0 },
	};
	const positionedVehicle: typeof vehicle.$inferSelect = {
		id: tripInput.vehicleId,
		organizationId: session.session.activeOrganizationId,
		connectionId: "fleet-connection",
		externalId: "provider-vehicle",
		name: "Truck",
		plate: null,
		lastLat: 0,
		lastLng: 0,
		lastHeading: null,
		lastSpeedKmh: null,
		lastPositionAt: createdAt,
		active: true,
		createdAt,
		updatedAt: createdAt,
	};

	it.each(fleetRouters)(
		"scopes %s reads to the session organization",
		async (routerName) => {
			const query = vi
				.spyOn(database.$client, "query")
				.mockResolvedValue([[], []]);
			const client = createRouterClient(appRouter, {
				context: contextFor(session),
			});
			await expect(client[routerName].list()).resolves.toEqual([]);
			expect(query).toHaveBeenCalledWith(
				expect.objectContaining({
					sql: expect.stringContaining("organization_id"),
				}),
				expect.arrayContaining([session.session.activeOrganizationId]),
			);
			if (routerName === "connections") {
				expect(query).not.toHaveBeenCalledWith(
					expect.objectContaining({
						sql: expect.stringContaining("encrypted_credentials"),
					}),
					expect.anything(),
				);
			}
			if (routerName === "alerts") {
				expect(query).toHaveBeenCalledWith(
					expect.objectContaining({
						sql: expect.stringContaining("left join `hack_the_andes_incident`"),
					}),
					expect.arrayContaining([ALERT_STATUS_OPEN]),
				);
				expect(query).not.toHaveBeenCalledWith(
					expect.objectContaining({
						sql: expect.stringContaining("`hack_the_andes_incident`.`active`"),
					}),
					expect.anything(),
				);
			}
		},
	);

	it("rejects invalid provider credentials before storing a connection", async () => {
		const query = vi.spyOn(database.$client, "query");
		vi.spyOn(samsaraProvider, "validateCredentials").mockRejectedValue(
			new Error("Provider authentication failed"),
		);
		const client = createRouterClient(appRouter, {
			context: contextFor(session),
		});
		await expect(
			client.connections.create({
				label: "Fleet GPS",
				credentials: { provider: "samsara", apiToken: "test-token" },
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: CREDENTIALS_VALIDATION_FAILED_MESSAGE,
		});
		expect(query).not.toHaveBeenCalled();
	});

	it("places a new demo fleet right away instead of waiting for fleet-sync", async () => {
		const sync = vi.spyOn(fleetSync, "syncConnection").mockResolvedValue({
			connectionId: "demo-connection",
			ok: true,
			vehiclesSynced: DEMO_VEHICLES.length,
			positionsInserted: DEMO_VEHICLES.length,
		});
		const query = vi.spyOn(database.$client, "query").mockResolvedValue([
			[
				{
					constructor: { name: "RowDataPacket" },
					...[
						"demo-connection",
						"demo",
						"Flota demo",
						"active",
						null,
						null,
						"2026-10-17 00:00:00.000",
						DEMO_VEHICLES.length,
					],
				},
			],
			[],
		]);
		const context = {
			...contextFor(session),
			encryptionKey: generateEncryptionKeyBase64(),
		};
		const client = createRouterClient(appRouter, { context });
		await expect(
			client.connections.create({
				label: "Flota demo",
				credentials: { provider: "demo" },
			}),
		).resolves.toMatchObject({
			provider: "demo",
			vehicleCount: DEMO_VEHICLES.length,
		});
		expect(sync).toHaveBeenCalledWith(
			expect.objectContaining({
				connection: expect.objectContaining({
					provider: "demo",
					organizationId: session.session.activeOrganizationId,
				}),
			}),
		);
		expect(query).toHaveBeenCalledWith(
			expect.objectContaining({
				sql: expect.stringContaining("insert into `hack_the_andes_vehicle`"),
			}),
			expect.arrayContaining(DEMO_VEHICLES.map(({ plate }) => plate)),
		);
		expect(context.log.getContext()).toMatchObject({
			fleet: {
				organizationId: session.session.activeOrganizationId,
				provider: "demo",
				vehiclesImported: DEMO_VEHICLES.length,
			},
		});
	});

	it("rejects another organization's vehicle without routing or cancelling trips", async () => {
		const query = vi
			.spyOn(database.$client, "query")
			.mockResolvedValue([[], []]);
		const fetchRoutes = vi.spyOn(routing, "fetchRouteCandidates");
		const client = createRouterClient(appRouter, {
			context: contextFor(session),
		});
		await expect(client.trips.create(tripInput)).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: VEHICLE_POSITION_REQUIRED_MESSAGE,
		});
		expect(query).toHaveBeenCalledWith(
			expect.objectContaining({
				sql: expect.stringContaining("organization_id"),
			}),
			expect.arrayContaining([
				tripInput.vehicleId,
				session.session.activeOrganizationId,
			]),
		);
		expect(fetchRoutes).not.toHaveBeenCalled();
		expect(query).not.toHaveBeenCalledWith(
			expect.objectContaining({
				sql: expect.stringMatching(/^(insert|update)/),
			}),
			expect.anything(),
		);
	});

	it("rejects a vehicle with no position before requesting a route", async () => {
		vi.spyOn(database.query.vehicle, "findFirst").mockResolvedValue({
			...positionedVehicle,
			lastLat: null,
			lastLng: null,
		});
		const fetchRoutes = vi.spyOn(routing, "fetchRouteCandidates");
		const client = createRouterClient(appRouter, {
			context: contextFor(session),
		});
		await expect(client.trips.create(tripInput)).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: VEHICLE_POSITION_REQUIRED_MESSAGE,
		});
		expect(fetchRoutes).not.toHaveBeenCalled();
	});

	it("only plans demo routes for trucks in a demo fleet", async () => {
		const samsaraVehicle = {
			...positionedVehicle,
			connection: { provider: "samsara" },
		};
		vi.spyOn(database.query.vehicle, "findFirst").mockResolvedValue(
			samsaraVehicle,
		);
		const planDemoTrip = vi.spyOn(demoTripPlanning, "planDemoTrip");
		const client = createRouterClient(appRouter, {
			context: contextFor(session),
		});
		await expect(
			client.trips.planDemo({
				vehicleId: positionedVehicle.id,
				scenario: "hazard",
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: DEMO_VEHICLE_REQUIRED_MESSAGE,
		});
		expect(planDemoTrip).not.toHaveBeenCalled();
	});

	it("plans a demo route from the truck's position past an active incident", async () => {
		const demoVehicle = {
			...positionedVehicle,
			connection: { provider: "demo" },
		};
		vi.spyOn(database.query.vehicle, "findFirst").mockResolvedValue(
			demoVehicle,
		);
		const incident: HazardIncident = {
			id: "huaico",
			category: "landslide",
			severity: "critical",
			title: "Huaico en la Carretera Central",
			geometry: null,
			lat: 1,
			lng: 1,
		};
		vi.spyOn(incidentLoading, "loadAlertableIncidents").mockResolvedValue([
			incident,
		]);
		const planDemoTrip = vi
			.spyOn(demoTripPlanning, "planDemoTrip")
			.mockResolvedValue({ destination: { lat: 2, lng: 2 }, incident });
		const context = contextFor(session);
		const client = createRouterClient(appRouter, { context });
		await expect(
			client.trips.planDemo({
				vehicleId: positionedVehicle.id,
				scenario: "hazard",
			}),
		).resolves.toEqual({
			destination: { lat: 2, lng: 2 },
			incidentTitle: incident.title,
		});
		expect(planDemoTrip).toHaveBeenCalledWith({
			osrmBaseUrl: context.osrmBaseUrl,
			origin: {
				lat: positionedVehicle.lastLat,
				lng: positionedVehicle.lastLng,
			},
			scenario: "hazard",
			incidents: [incident],
		});
	});

	describe("immediate hazard evaluation", () => {
		const destination = { lat: 0.1, lng: 0.1 };
		const route: RouteCandidate = {
			geometry: {
				type: "LineString",
				coordinates: [
					[0, 0],
					[destination.lng, destination.lat],
				],
			},
			distanceM: 15_700,
			durationS: 900,
		};
		const huaico: HazardIncident = {
			id: "huaico",
			category: "landslide",
			severity: "critical",
			title: "Huaico en la ruta",
			geometry: null,
			lat: 0.05,
			lng: 0.05,
		};
		const writeResult = {
			affectedRows: 1,
			constructor: { name: "ResultSetHeader" } satisfies {
				name: "ResultSetHeader";
			},
			fieldCount: 0,
			info: "",
			insertId: 0,
			serverStatus: 0,
			warningStatus: 0,
			changedRows: 1,
		};

		beforeEach(() => {
			vi.spyOn(database.query.vehicle, "findFirst").mockResolvedValue(
				positionedVehicle,
			);
			vi.spyOn(routing, "fetchRouteCandidates").mockResolvedValue([route]);
		});

		it("persists an alert for an incident on the new route before fleet-sync runs", async () => {
			vi.spyOn(incidentLoading, "loadAlertableIncidents").mockResolvedValue([
				huaico,
			]);
			const query = vi
				.spyOn(database.$client, "query")
				.mockImplementation(async (options) => [
					typeof options === "object" && options.rowsAsArray ? [] : writeResult,
					[],
				]);
			const findTrip = vi.spyOn(database.query.trip, "findFirst");
			const context = contextFor(session);
			const client = createRouterClient(appRouter, { context });
			const createdTrip = await client.trips.create({
				...tripInput,
				destination,
			});
			const tripWrite = query.mock.calls.find(
				([options]) =>
					typeof options === "object" &&
					options.sql.startsWith("insert into `hack_the_andes_trip`"),
			);
			const tripParameters = tripWrite?.[1];
			if (!Array.isArray(tripParameters))
				throw new Error("Expected trip insert parameters");
			const [tripId, organizationId, vehicleId] = tripParameters;
			expect(createdTrip).toMatchObject({
				id: tripId,
				organizationId,
				vehicleId,
				lastEvaluatedAt: createdTrip.createdAt,
			});
			expect(createdTrip.lastEvaluatedAt).toBeInstanceOf(Date);
			const createdAtParameter = createdTrip.createdAt
				.toISOString()
				.replace("T", " ")
				.replace("Z", "");
			expect(tripParameters).toContain(createdAtParameter);
			expect(findTrip).not.toHaveBeenCalled();
			expect(routing.fetchRouteCandidates).toHaveBeenCalledTimes(1);
			const alertWrite = query.mock.calls.find(
				([options]) =>
					typeof options === "object" &&
					options.sql.startsWith("insert into `hack_the_andes_alert`"),
			);
			expect(alertWrite?.[1]).toEqual(
				expect.arrayContaining([
					tripId,
					organizationId,
					vehicleId,
					huaico.id,
					"hazard_ahead",
					"open",
				]),
			);
			expect(query).toHaveBeenCalledWith(
				expect.objectContaining({
					sql: expect.stringMatching(
						/^update `hack_the_andes_trip` set .*`last_evaluated_at`/,
					),
				}),
				expect.arrayContaining([tripId, organizationId, createdAtParameter]),
			);
			expect(context.log.getContext()).toMatchObject({
				fleet: { alertsCreated: 1, alertsUpdated: 0 },
			});
		});

		it("still creates the trip when hazard evaluation fails", async () => {
			vi.spyOn(incidentLoading, "loadAlertableIncidents").mockRejectedValue(
				new Error("select private-sql"),
			);
			vi.spyOn(database.$client, "query").mockResolvedValue([writeResult, []]);
			const context = contextFor(session);
			const client = createRouterClient(appRouter, { context });
			await expect(
				client.trips.create({ ...tripInput, destination }),
			).resolves.toMatchObject({
				status: "active",
				lastEvaluatedAt: null,
			});
			expect(context.log.getContext()).toMatchObject({
				fleet: { tripEvaluationError: "Error" },
			});
			expect(JSON.stringify(context.log.getContext())).not.toContain(
				"private-sql",
			);
		});
	});

	it("records the routing failure behind a rejected demo plan", async () => {
		const demoVehicle = {
			...positionedVehicle,
			connection: { provider: "demo" },
		};
		vi.spyOn(database.query.vehicle, "findFirst").mockResolvedValue(
			demoVehicle,
		);
		vi.spyOn(incidentLoading, "loadAlertableIncidents").mockResolvedValue([]);
		vi.spyOn(demoTripPlanning, "planDemoTrip").mockRejectedValue(
			new Error("OSRM responded with 503"),
		);
		const context = contextFor(session);
		const client = createRouterClient(appRouter, { context });
		await expect(
			client.trips.planDemo({
				vehicleId: positionedVehicle.id,
				scenario: "hazard",
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: ROUTING_FAILED_MESSAGE,
		});
		expect(context.log.getContext()).toMatchObject({
			fleet: { demoRouteError: "OSRM responded with 503" },
		});
	});

	it.each([true, false])(
		"preserves active trips when routing fails (throws: %s)",
		async (routingThrows) => {
			vi.spyOn(database.query.vehicle, "findFirst").mockResolvedValue(
				positionedVehicle,
			);
			const query = vi.spyOn(database.$client, "query");
			const fetchRoutes = vi.spyOn(routing, "fetchRouteCandidates");
			if (routingThrows)
				fetchRoutes.mockRejectedValue(new Error("Routing unavailable"));
			else fetchRoutes.mockResolvedValue([]);
			const context = contextFor(session);
			const client = createRouterClient(appRouter, { context });
			await expect(client.trips.create(tripInput)).rejects.toMatchObject({
				code: "BAD_REQUEST",
				message: ROUTING_FAILED_MESSAGE,
			});
			expect(fetchRoutes).toHaveBeenCalledWith({
				baseUrl: context.osrmBaseUrl,
				origin: {
					lat: positionedVehicle.lastLat,
					lng: positionedVehicle.lastLng,
				},
				destination: tripInput.destination,
			});
			expect(query).not.toHaveBeenCalled();
		},
	);
});

describe("credential error isolation", () => {
	it("does not return provider causes or put secrets in the wide event", async () => {
		vi.spyOn(samsaraProvider, "validateCredentials").mockRejectedValue(
			new Error("Bearer private-token"),
		);
		const context = contextFor(session);
		const client = createRouterClient(appRouter, { context });
		const error = await client.connections
			.create({
				label: "GPS",
				credentials: { provider: "samsara", apiToken: "private-token" },
			})
			.catch((error) => error);
		expect(error.code).toBe("BAD_REQUEST");
		expect(error.cause).toBeUndefined();
		expect(JSON.stringify(context.log.getContext())).not.toContain(
			"private-token",
		);
	});

	it("redacts database SQL and nested causes before logging or rethrowing", async () => {
		const context = contextFor(session);
		const failingProcedure = protectedProcedure.handler(() => {
			throw new Error("insert encrypted_credentials private-ciphertext", {
				cause: new Error("private-password"),
			});
		});
		const error = await call(failingProcedure, undefined, { context }).catch(
			(error) => error,
		);
		expect(error.code).toBe("INTERNAL_SERVER_ERROR");
		expect(error.cause).toBeUndefined();
		expect(JSON.stringify(context.log.getContext())).not.toMatch(
			/private-ciphertext|private-password/,
		);
	});

	it("keeps the error class and driver code in the wide event", async () => {
		const context = contextFor(session);
		const failingProcedure = protectedProcedure.handler(() => {
			throw new TypeError("insert private-ciphertext", {
				cause: Object.assign(new Error("Duplicate entry private-password"), {
					code: "ER_DUP_ENTRY",
				}),
			});
		});
		await call(failingProcedure, undefined, { context }).catch(() => null);
		const loggedContext = JSON.stringify(context.log.getContext());
		expect(loggedContext).toContain("TypeError:ER_DUP_ENTRY");
		expect(loggedContext).not.toMatch(/private-ciphertext|private-password/);
	});
});

describe("trip completion alert cleanup", () => {
	it.each(["cancel", "complete"] as const)(
		"resolves outstanding tenant alerts on %s",
		async (action) => {
			const status = action === "cancel" ? "cancelled" : "completed";
			vi.spyOn(database.query.trip, "findFirst").mockResolvedValue({
				id: "trip",
				status,
				name: "Trip",
				organizationId: session.session.activeOrganizationId,
				vehicleId: "vehicle",
				originLat: 0,
				originLng: 0,
				destinationLat: 1,
				destinationLng: 1,
				destinationName: "Destination",
				routeGeometry: {
					type: "LineString",
					coordinates: [
						[0, 0],
						[1, 1],
					],
				},
				routeDistanceM: 1000,
				routeDurationS: 100,
				etaAt: null,
				lastEvaluatedAt: null,
				createdAt,
				updatedAt: createdAt,
			});
			const query = vi.spyOn(database.$client, "query").mockResolvedValue([
				{
					affectedRows: 1,
					constructor: { name: "ResultSetHeader" },
					fieldCount: 0,
					info: "",
					insertId: 0,
					serverStatus: 0,
					warningStatus: 0,
					changedRows: 1,
				},
				[],
			]);
			const client = createRouterClient(appRouter, {
				context: contextFor(session),
			});
			await expect(client.trips[action]({ id: "trip" })).resolves.toEqual({
				id: "trip",
				status,
			});
			expect(query).toHaveBeenCalledWith(
				expect.objectContaining({
					sql: expect.stringContaining("update `hack_the_andes_alert`"),
				}),
				expect.arrayContaining([
					session.session.activeOrganizationId,
					"resolved",
					"open",
					"acknowledged",
				]),
			);
		},
	);
});

describe("shared demo account boundaries", () => {
	const demoSession = {
		...session,
		user: { ...session.user, email: DEMO_ACCOUNT_EMAIL },
	};

	it.each([
		{ provider: "samsara", apiToken: "token" },
		{
			provider: "geotab",
			server: "my.geotab.com",
			database: "fleet",
			userName: "owner",
			password: "password",
		},
	] satisfies Array<
		import("@hack-the-andes-project/business/providers/index").GpsCredentialsInput
	>)("forbids a demo user from connecting $provider", async (credentials) => {
		const query = vi.spyOn(database.$client, "query");
		const client = createRouterClient(appRouter, {
			context: contextFor(demoSession),
		});
		await expect(
			client.connections.create({ label: "GPS", credentials }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(query).not.toHaveBeenCalled();
	});

	it("forbids removing the shared demo connection before looking it up", async () => {
		const findConnection = vi.spyOn(database.query.gpsConnection, "findFirst");
		const client = createRouterClient(appRouter, {
			context: contextFor(demoSession),
		});
		await expect(
			client.connections.remove({ id: "demo-connection" }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(findConnection).not.toHaveBeenCalled();
	});

	it("rejects prepare for ordinary accounts", async () => {
		const query = vi.spyOn(database.$client, "query");
		const client = createRouterClient(appRouter, {
			context: contextFor(session),
		});
		await expect(client.demo.prepare()).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		expect(query).not.toHaveBeenCalled();
	});
});

describe("demo reset orchestration", () => {
	it("returns not found before wiping when the demo user has never signed in", async () => {
		vi.spyOn(database.query.user, "findFirst").mockResolvedValue(undefined);
		const wipe = vi.spyOn(demoSeeding, "wipeDemoFleet");
		await expect(resetDemo(contextFor(null))).resolves.toBeNull();
		expect(wipe).not.toHaveBeenCalled();
	});

	it("wipes the personal demo organization and reseeds through the prepare service", async () => {
		const demoUser = {
			...session.user,
			email: DEMO_ACCOUNT_EMAIL,
			image: null,
		};
		vi.spyOn(database.query.user, "findFirst").mockResolvedValue(demoUser);
		vi.spyOn(database.query.member, "findFirst").mockResolvedValue({
			id: "demo-member",
			organizationId: demoUser.id,
			userId: demoUser.id,
			role: "owner",
			createdAt,
		});
		const wipe = vi.spyOn(demoSeeding, "wipeDemoFleet").mockResolvedValue();
		const seed = vi
			.spyOn(demoSeeding, "prepareDemo")
			.mockResolvedValue({ vehicleCount: 6, tripCount: 2 });
		const context = contextFor(null);
		await expect(resetDemo(context)).resolves.toEqual({
			vehicleCount: 6,
			tripCount: 2,
		});
		expect(wipe).toHaveBeenCalledWith(database, demoUser.id);
		expect(seed).toHaveBeenCalledWith({
			...context,
			organizationId: demoUser.id,
		});
		expect(wipe.mock.invocationCallOrder[0]).toBeLessThan(
			seed.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
		);
	});
});

describe("risk procedures", () => {
	const origin = { lat: -12.05, lng: -76.88 };
	const destination = { lat: -12.07, lng: -75.21 };

	it("rejects unauthenticated risk queries", async () => {
		const client = createRouterClient(appRouter, {
			context: contextFor(null),
		});
		await expect(client.risk.segments({})).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	it("lists segments for the requested horizon with the disclaimer", async () => {
		const query = vi
			.spyOn(database.$client, "query")
			.mockResolvedValue([[], []]);
		const client = createRouterClient(appRouter, {
			context: contextFor(session),
		});

		const result = await client.risk.segments({
			horizonHours: 48,
			roadCode: "PE-22",
		});

		expect(result).toEqual({
			segments: [],
			disclaimer: RISK_DISCLAIMER_MESSAGE,
		});
		expect(query).toHaveBeenCalledWith(
			expect.objectContaining({
				sql: expect.stringContaining("horizon_hours"),
			}),
			expect.arrayContaining([48, "PE-22"]),
		);
	});

	it("rejects horizons other than 24, 48 and 72 hours", async () => {
		const client = createRouterClient(appRouter, {
			context: contextFor(session),
		});
		await expect(
			client.risk.segments({ horizonHours: 36 as 24 }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			client.risk.compareRoutes({
				origin,
				destination,
				horizonHours: 12 as 24,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("compares routes for a 24 h horizon by default", async () => {
		const comparison = {
			fastest: null,
			safest: null,
			closures: [],
			officialDetours: [
				{
					id: "detour",
					name: "Desvío Canta",
					geometry: null,
					roadCodes: ["PE-20A"],
				},
			],
			assessedFrom: null,
			assessedUntil: null,
		};
		const compare = vi
			.spyOn(riskRoutes, "compareRiskAwareRoutes")
			.mockResolvedValue(comparison);
		const client = createRouterClient(appRouter, {
			context: contextFor(session),
		});

		const result = await client.risk.compareRoutes({ origin, destination });

		expect(compare).toHaveBeenCalledWith(
			expect.objectContaining({
				origin,
				destination,
				horizonHours: 24,
				now: expect.any(Date),
			}),
		);
		expect(result).toEqual({
			...comparison,
			horizonHours: 24,
			disclaimer: RISK_DISCLAIMER_MESSAGE,
		});
	});
});

describe("route review procedures", () => {
	const departureAt = new Date("2026-10-18T13:00:00Z");
	const input = {
		originPlaceId: "lima" as const,
		destinationPlaceId: "huancayo" as const,
		departureAt,
		vehicleAxleCount: 6,
	};

	it("rejects unauthenticated route reviews", async () => {
		const client = createRouterClient(appRouter, {
			context: contextFor(null),
		});
		await expect(client.routeReview.evaluate(input)).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	it("rejects the same origin and destination", async () => {
		const client = createRouterClient(appRouter, {
			context: contextFor(session),
		});
		await expect(
			client.routeReview.evaluate({ ...input, destinationPlaceId: "lima" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("evaluates the places' coordinates for the vehicle's axles", async () => {
		const evaluation = {
			horizons: ["now" as const, "24h" as const],
			recommendedCandidateId: null,
			candidates: [],
		};
		const evaluate = vi
			.spyOn(routeReviewEvaluation, "evaluateRouteReview")
			.mockResolvedValue(evaluation);
		const client = createRouterClient(appRouter, {
			context: contextFor(session),
		});

		const review = await client.routeReview.evaluate(input);

		expect(evaluate).toHaveBeenCalledWith(
			expect.objectContaining({
				origin: ROUTE_REVIEW_PLACES.lima,
				destination: ROUTE_REVIEW_PLACES.huancayo,
				departureAt,
				axleCount: 6,
				osrmBaseUrl: expect.any(String),
				now: expect.any(Date),
			}),
		);
		expect(review).toEqual({
			id: expect.any(String),
			originPlaceId: "lima",
			destinationPlaceId: "huancayo",
			vehicleAxleCount: 6,
			departureAt,
			...evaluation,
			evaluatedAt: expect.any(Date),
		});
	});
});
