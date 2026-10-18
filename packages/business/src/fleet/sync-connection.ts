import type { Database } from "@hack-the-andes-project/db";
import { ID_LENGTH_CHARS } from "@hack-the-andes-project/db/schema/constants";
import {
	gpsConnection,
	trip,
	vehicle,
	vehiclePosition,
} from "@hack-the-andes-project/db/schema/fleet";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { RequestLogger } from "evlog";

import {
	FLEET_WRITE_BATCH_SIZE_ROWS,
	HEX_BYTE_LENGTH_CHARS,
	HEX_RADIX,
} from "../constants";
import { decryptJson } from "../crypto/index";
import {
	gpsCredentialsSchema,
	providerFor,
	simulateDemoPositions,
} from "../providers/index";
import { planPositionUpdates } from "./decisions";
import { incomingValue } from "./sql";

export interface SyncConnectionInput {
	db: Database;
	encryptionKey: string;
	connection: typeof gpsConnection.$inferSelect;
	now: Date;
	log: RequestLogger;
}

export interface SyncConnectionResult {
	connectionId: string;
	ok: boolean;
	vehiclesSynced: number;
	positionsInserted: number;
	error?: string;
}

export async function syncConnection({
	db,
	encryptionKey,
	connection,
	now,
	log,
}: SyncConnectionInput): Promise<SyncConnectionResult> {
	const result: SyncConnectionResult = {
		connectionId: connection.id,
		ok: false,
		vehiclesSynced: 0,
		positionsInserted: 0,
	};
	let failureMessage = "No se pudieron descifrar las credenciales GPS.";
	try {
		const credentials = await decryptJson(
			encryptionKey,
			connection.encryptedCredentials,
			gpsCredentialsSchema,
		);
		if (credentials.provider !== connection.provider) {
			throw new Error("GPS provider mismatch");
		}
		failureMessage = "No se pudieron consultar los vehículos y posiciones GPS.";
		const provider = providerFor(connection.provider);
		const [providerVehicles, positions] = await Promise.all([
			provider.listVehicles(credentials),
			credentials.provider === "demo"
				? db
						.select({
							externalId: vehicle.externalId,
							lastLat: vehicle.lastLat,
							lastLng: vehicle.lastLng,
							activeTrip: {
								routeGeometry: trip.routeGeometry,
								routeDistanceM: trip.routeDistanceM,
								routeDurationS: trip.routeDurationS,
								destinationLat: trip.destinationLat,
								destinationLng: trip.destinationLng,
								createdAt:
									sql<Date>`coalesce(${trip.startedAt}, ${trip.createdAt})`.mapWith(
										trip.createdAt,
									),
							},
						})
						.from(vehicle)
						.leftJoin(
							trip,
							and(
								eq(trip.vehicleId, vehicle.id),
								eq(trip.organizationId, vehicle.organizationId),
								eq(trip.status, "active"),
							),
						)
						.where(
							and(
								eq(vehicle.connectionId, connection.id),
								eq(vehicle.organizationId, connection.organizationId),
							),
						)
						.then((fleet) => simulateDemoPositions(fleet, now))
				: provider.fetchLatestPositions(credentials),
		]);
		failureMessage = "No se pudieron guardar los vehículos y posiciones GPS.";
		const vehicles = [
			...new Map(
				providerVehicles.map((entry) => [entry.externalId, entry]),
			).values(),
		];
		for (
			let offset = 0;
			offset < vehicles.length;
			offset += FLEET_WRITE_BATCH_SIZE_ROWS
		) {
			const batch = vehicles.slice(
				offset,
				offset + FLEET_WRITE_BATCH_SIZE_ROWS,
			);
			await db
				.insert(vehicle)
				.values(
					batch.map((entry) => ({
						...entry,
						id: crypto.randomUUID(),
						organizationId: connection.organizationId,
						connectionId: connection.id,
						active: true,
					})),
				)
				.onDuplicateKeyUpdate({
					set: {
						name: incomingValue(vehicle.name),
						plate: incomingValue(vehicle.plate),
						active: true,
					},
				});
			result.vehiclesSynced += batch.length;
			const storedVehicles = await db
				.select()
				.from(vehicle)
				.where(
					and(
						eq(vehicle.connectionId, connection.id),
						eq(vehicle.organizationId, connection.organizationId),
						inArray(
							vehicle.externalId,
							batch.map((entry) => entry.externalId),
						),
					),
				);
			const updates = planPositionUpdates(storedVehicles, positions);
			if (updates.length === 0) continue;
			const history = await Promise.all(
				updates.map(async ({ vehicleId, position }) => {
					// Stable IDs let an overlapping run or a retry reuse history written before the checkpoint.
					const digest = await crypto.subtle.digest(
						"SHA-256",
						new TextEncoder().encode(
							JSON.stringify([vehicleId, position.recordedAt.toISOString()]),
						),
					);
					const positionId = Array.from(new Uint8Array(digest), (byte) =>
						byte.toString(HEX_RADIX).padStart(HEX_BYTE_LENGTH_CHARS, "0"),
					)
						.join("")
						.slice(0, ID_LENGTH_CHARS);
					return {
						id: positionId,
						vehicleId,
						lat: position.lat,
						lng: position.lng,
						speedKmh: position.speedKmh,
						heading: position.heading,
						recordedAt: position.recordedAt,
					};
				}),
			);
			await db
				.insert(vehiclePosition)
				.values(history)
				.onDuplicateKeyUpdate({
					set: { id: sql`${vehiclePosition.id}` },
				});
			result.positionsInserted += history.length;
			const positionsByVehicleId = new Map(
				history.map((position) => [position.vehicleId, position]),
			);
			const positionRows = storedVehicles.flatMap((storedVehicle) => {
				const position = positionsByVehicleId.get(storedVehicle.id);
				return position
					? [
							{
								id: storedVehicle.id,
								organizationId: storedVehicle.organizationId,
								connectionId: storedVehicle.connectionId,
								externalId: storedVehicle.externalId,
								name: storedVehicle.name,
								plate: storedVehicle.plate,
								lastLat: position.lat,
								lastLng: position.lng,
								lastSpeedKmh: position.speedKmh,
								lastHeading: position.heading,
								lastPositionAt: position.recordedAt,
								active: true,
							},
						]
					: [];
			});
			const isNewer = sql`${vehicle.lastPositionAt} is null or ${incomingValue(vehicle.lastPositionAt)} > ${vehicle.lastPositionAt}`;
			await db
				.insert(vehicle)
				.values(positionRows)
				.onDuplicateKeyUpdate({
					set: {
						lastLat: sql`if(${isNewer}, ${incomingValue(vehicle.lastLat)}, ${vehicle.lastLat})`,
						lastLng: sql`if(${isNewer}, ${incomingValue(vehicle.lastLng)}, ${vehicle.lastLng})`,
						lastSpeedKmh: sql`if(${isNewer}, ${incomingValue(vehicle.lastSpeedKmh)}, ${vehicle.lastSpeedKmh})`,
						lastHeading: sql`if(${isNewer}, ${incomingValue(vehicle.lastHeading)}, ${vehicle.lastHeading})`,
						// MySQL evaluates assignments in Drizzle's schema order; lastPositionAt must follow the guarded fields.
						lastPositionAt: sql`if(${isNewer}, ${incomingValue(vehicle.lastPositionAt)}, ${vehicle.lastPositionAt})`,
					},
				});
		}
		failureMessage = "No se pudo actualizar el estado de la conexión GPS.";
		await db
			.update(gpsConnection)
			.set({
				lastSyncAt: now,
				status: "active",
				lastError: null,
			})
			.where(
				and(
					eq(gpsConnection.id, connection.id),
					eq(gpsConnection.organizationId, connection.organizationId),
				),
			);
		result.ok = true;
	} catch {
		// Provider errors may echo secrets; persist only the operation that failed.
		result.error = failureMessage;
		await db
			.update(gpsConnection)
			.set({
				lastSyncAt: now,
				status: "error",
				lastError: failureMessage,
			})
			.where(
				and(
					eq(gpsConnection.id, connection.id),
					eq(gpsConnection.organizationId, connection.organizationId),
				),
			);
	} finally {
		log.set({ fleet: { connections: { [connection.id]: result } } });
		if (!result.ok) log.setLevel("error");
	}
	return result;
}
