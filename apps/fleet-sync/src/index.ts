import {
	type EvaluateTripResult,
	evaluateTrip,
	findDemoOrganizationId,
	loadAlertableIncidents,
	pruneVehiclePositions,
	resolveObsoleteAlerts,
	restartFinishedDemo,
	type SyncConnectionResult,
	syncConnection,
} from "@hack-the-andes-project/business";
import { verifySecret } from "@hack-the-andes-project/business/crypto/index";
import { createDb } from "@hack-the-andes-project/db";
import {
	gpsConnection,
	trip,
	vehicle,
} from "@hack-the-andes-project/db/schema/fleet";
import { and, eq } from "drizzle-orm";
import { createLogger } from "evlog";
import { initWorkersLogger } from "evlog/workers";

import { HTTP_STATUS, RUN_SECRET_HEADER, SERVICE_NAME } from "./constants";
import { ENV } from "./env.server";

initWorkersLogger({
	env: {
		service: SERVICE_NAME,
		environment: ENV.APP_ENV,
		version: ENV.SERVICE_VERSION,
	},
});

interface RunSummary {
	ok: boolean;
	connections: SyncConnectionResult[];
	trips: EvaluateTripResult[];
	error?: string;
}

async function syncAll(
	trigger: string,
	connectionId?: string,
): Promise<RunSummary> {
	const log = createLogger({ job: "fleet-sync", trigger, connectionId });
	const summary: RunSummary = { ok: false, connections: [], trips: [] };
	const now = new Date();
	try {
		const db = await createDb(ENV.HYPERDRIVE);
		try {
			if (!connectionId) {
				log.set({ positionsPruned: await pruneVehiclePositions(db, now) });
			}
			const connections = await db
				.select()
				.from(gpsConnection)
				.where(connectionId ? eq(gpsConnection.id, connectionId) : undefined);
			if (connectionId && connections.length === 0) {
				summary.error = "unknown_connection";
				return summary;
			}
			await resolveObsoleteAlerts({
				db,
				now,
				organizationId: connectionId
					? connections[0]?.organizationId
					: undefined,
			});
			for (const connection of connections) {
				try {
					summary.connections.push(
						await syncConnection({
							db,
							encryptionKey: ENV.CREDENTIALS_ENCRYPTION_KEY,
							connection,
							now,
							log,
						}),
					);
				} catch {
					summary.connections.push({
						connectionId: connection.id,
						ok: false,
						vehiclesSynced: 0,
						positionsInserted: 0,
						error: "No se pudo guardar el resultado de la sincronización GPS.",
					});
				}
			}
			const [activeTrips, incidents] = await Promise.all([
				db
					.select({ trip, vehicle })
					.from(trip)
					.innerJoin(
						vehicle,
						and(
							eq(trip.vehicleId, vehicle.id),
							eq(trip.organizationId, vehicle.organizationId),
						),
					)
					.where(
						and(
							eq(trip.status, "active"),
							connectionId ? eq(vehicle.connectionId, connectionId) : undefined,
						),
					),
				loadAlertableIncidents(db),
			]);
			for (const entry of activeTrips) {
				try {
					summary.trips.push(
						await evaluateTrip({
							db,
							osrmBaseUrl: ENV.OSRM_BASE_URL,
							trip: entry.trip,
							vehicle: entry.vehicle,
							incidents,
							now,
							log,
						}),
					);
				} catch {
					summary.trips.push({
						tripId: entry.trip.id,
						ok: false,
						completed: false,
						rerouted: false,
						alertsCreated: 0,
						alertsUpdated: 0,
						alertsResolved: 0,
						error: "No se pudo evaluar el viaje.",
					});
				}
			}
			await resolveObsoleteAlerts({
				db,
				now,
				organizationId: connectionId
					? connections[0]?.organizationId
					: undefined,
			});
			const demoOrganizationId = await findDemoOrganizationId(db);
			if (
				demoOrganizationId &&
				connections.some(
					(connection) => connection.organizationId === demoOrganizationId,
				)
			)
				await restartFinishedDemo({
					db,
					organizationId: demoOrganizationId,
					encryptionKey: ENV.CREDENTIALS_ENCRYPTION_KEY,
					osrmBaseUrl: ENV.OSRM_BASE_URL,
					log,
				});
			summary.ok =
				summary.connections.every((result) => result.ok) &&
				summary.trips.every((result) => result.ok);
		} finally {
			await db.$client.end();
		}
	} catch {
		summary.ok = false;
		summary.error = "No se pudo completar la sincronización de la flota.";
	} finally {
		log.set({ run: summary });
		if (!summary.ok) log.setLevel("error");
		log.emit();
	}
	return summary;
}

export default {
	async scheduled(
		controller: ScheduledController,
		_env: Env,
		context: ExecutionContext,
	) {
		context.waitUntil(syncAll(`cron:${controller.cron}`));
	},
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/") return new Response("OK");
		if (url.pathname !== "/run" || request.method !== "POST") {
			return Response.json(
				{ error: "not_found" },
				{ status: HTTP_STATUS.NOT_FOUND },
			);
		}
		if (
			!verifySecret(
				request.headers.get(RUN_SECRET_HEADER),
				ENV.FLEET_SYNC_RUN_SECRET,
			)
		) {
			return Response.json(
				{ error: "unauthorized" },
				{ status: HTTP_STATUS.UNAUTHORIZED },
			);
		}
		const summary = await syncAll(
			"manual",
			url.searchParams.get("connection") ?? undefined,
		);
		const status = summary.ok
			? HTTP_STATUS.OK
			: summary.error === "unknown_connection"
				? HTTP_STATUS.NOT_FOUND
				: HTTP_STATUS.INTERNAL_SERVER_ERROR;
		return Response.json(summary, { status });
	},
};
