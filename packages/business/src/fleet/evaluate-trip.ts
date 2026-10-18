import type { Database } from "@hack-the-andes-project/db";
import {
	alert,
	trip as tripTable,
	type vehicle as vehicleTable,
} from "@hack-the-andes-project/db/schema/fleet";
import { distance } from "@turf/distance";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { RequestLogger } from "evlog";

import { FLEET_WRITE_BATCH_SIZE_ROWS, MS_PER_SECOND } from "../constants";
import { chooseAlternativeRoute } from "../hazards/alternative";
import { estimateEta } from "../hazards/eta";
import { findHazardsAhead } from "../hazards/hazards-ahead";
import { projectOntoRoute } from "../hazards/progress";
import type {
	HazardIncident,
	RouteCandidate,
	VehicleState,
} from "../hazards/types";
import { fetchRouteCandidates } from "../routing/osrm";
import { decideTripProgress, formatHazardAlert } from "./decisions";
import { incomingValue } from "./sql";

export interface EvaluateTripInput {
	db: Database;
	osrmBaseUrl: string;
	trip: typeof tripTable.$inferSelect;
	vehicle: typeof vehicleTable.$inferSelect;
	incidents: HazardIncident[];
	routeCandidates?: RouteCandidate[];
	now: Date;
	log: RequestLogger;
}

export interface EvaluateTripResult {
	tripId: string;
	ok: boolean;
	completed: boolean;
	rerouted: boolean;
	alertsCreated: number;
	alertsUpdated: number;
	alertsResolved: number;
	skipped?: "no_position" | "inactive_trip";
	error?: string;
}

export async function evaluateTrip({
	db,
	osrmBaseUrl,
	trip,
	vehicle,
	incidents,
	routeCandidates,
	now,
	log,
}: EvaluateTripInput): Promise<EvaluateTripResult> {
	const result: EvaluateTripResult = {
		tripId: trip.id,
		ok: false,
		completed: false,
		rerouted: false,
		alertsCreated: 0,
		alertsUpdated: 0,
		alertsResolved: 0,
	};
	let failureMessage = "No se pudo evaluar el recorrido del viaje.";
	try {
		if (trip.status !== "active") {
			result.ok = true;
			result.skipped = "inactive_trip";
			return result;
		}
		if (
			vehicle.id !== trip.vehicleId ||
			vehicle.organizationId !== trip.organizationId
		) {
			throw new Error("Trip vehicle mismatch");
		}
		if (
			vehicle.lastLat === null ||
			vehicle.lastLng === null ||
			!vehicle.lastPositionAt
		) {
			result.ok = true;
			result.skipped = "no_position";
			return result;
		}
		const vehicleState: VehicleState = {
			position: { lat: vehicle.lastLat, lng: vehicle.lastLng },
			speedKmh: vehicle.lastSpeedKmh,
			heading: vehicle.lastHeading,
			recordedAt: vehicle.lastPositionAt,
		};
		let route: RouteCandidate = {
			geometry: trip.routeGeometry,
			distanceM: trip.routeDistanceM,
			durationS: trip.routeDurationS,
		};
		let progress = projectOntoRoute(route.geometry, vehicleState.position);
		const destinationDistanceM = distance(
			[vehicle.lastLng, vehicle.lastLat],
			[trip.destinationLng, trip.destinationLat],
			{ units: "meters" },
		);
		const decision = decideTripProgress(progress, destinationDistanceM);
		const unresolvedAlerts = and(
			eq(alert.tripId, trip.id),
			eq(alert.organizationId, trip.organizationId),
			inArray(alert.status, ["open", "acknowledged"]),
		);
		const activeTrip = and(
			eq(tripTable.id, trip.id),
			eq(tripTable.organizationId, trip.organizationId),
			eq(tripTable.status, "active"),
		);
		if (decision.arrived) {
			const [resolved] = await db
				.update(alert)
				.set({
					status: "resolved",
					resolvedAt: now,
				})
				.where(unresolvedAlerts);
			result.alertsResolved = resolved.affectedRows;
			const [completed] = await db
				.update(tripTable)
				.set({
					status: "completed",
					etaAt: now,
					lastEvaluatedAt: now,
				})
				.where(activeTrip);
			result.completed = completed.affectedRows > 0;
			result.ok = true;
			return result;
		}
		const routeRequest = {
			baseUrl: osrmBaseUrl,
			origin: vehicleState.position,
			destination: { lat: trip.destinationLat, lng: trip.destinationLng },
		};
		let candidates = routeCandidates;
		if (decision.reroute) {
			failureMessage = "No se pudo recalcular la ruta del viaje.";
			candidates = await fetchRouteCandidates(routeRequest);
			const primaryRoute = candidates[0];
			if (!primaryRoute) throw new Error("OSRM returned no route");
			route = primaryRoute;
			progress = projectOntoRoute(route.geometry, vehicleState.position);
		}
		failureMessage = "No se pudieron guardar la ruta y la hora de llegada.";
		const etaAt = estimateEta({ route, progress, vehicle: vehicleState, now });
		const [evaluated] = await db
			.update(tripTable)
			.set({
				...(decision.reroute
					? {
							routeGeometry: route.geometry,
							routeDistanceM: route.distanceM,
							routeDurationS: route.durationS,
						}
					: {}),
				etaAt,
				lastEvaluatedAt: now,
			})
			.where(activeTrip);
		if (evaluated.affectedRows === 0) {
			result.ok = true;
			result.skipped = "inactive_trip";
			return result;
		}
		result.rerouted = decision.reroute;
		failureMessage = "No se pudieron actualizar las alertas del viaje.";
		const hazards = findHazardsAhead({
			route,
			vehicle: vehicleState,
			incidents,
		});
		const existingAlerts = await db
			.select({ incidentId: alert.incidentId })
			.from(alert)
			.where(
				and(
					eq(alert.tripId, trip.id),
					eq(alert.organizationId, trip.organizationId),
				),
			);
		const existingIncidentIds = new Set(
			existingAlerts.map((entry) => entry.incidentId),
		);
		let alternativeRoute: RouteCandidate | null = null;
		if (
			hazards.some((hazard) => !existingIncidentIds.has(hazard.incident.id))
		) {
			try {
				candidates ??= await fetchRouteCandidates(routeRequest);
				alternativeRoute = chooseAlternativeRoute({
					candidates,
					incidents,
					originalDurationS: candidates[0]?.durationS ?? route.durationS,
				});
			} catch {
				result.error = "No se pudo consultar una ruta alternativa.";
			}
		}
		const alertRows = hazards.map((hazard): typeof alert.$inferInsert => ({
			id: crypto.randomUUID(),
			organizationId: trip.organizationId,
			tripId: trip.id,
			vehicleId: vehicle.id,
			incidentId: hazard.incident.id,
			kind: "hazard_ahead",
			status: "open",
			...formatHazardAlert(hazard),
			severity: hazard.severity,
			distanceAheadM: hazard.distanceAheadM,
			etaToHazardAt:
				hazard.etaSeconds === null
					? null
					: new Date(now.getTime() + hazard.etaSeconds * MS_PER_SECOND),
			alternativeRoute,
		}));
		for (
			let offset = 0;
			offset < alertRows.length;
			offset += FLEET_WRITE_BATCH_SIZE_ROWS
		) {
			const batch = alertRows.slice(
				offset,
				offset + FLEET_WRITE_BATCH_SIZE_ROWS,
			);
			await db
				.insert(alert)
				.values(batch)
				.onDuplicateKeyUpdate({
					set: {
						status: sql`if(${alert.status} = 'resolved', 'open', ${alert.status})`,
						resolvedAt: null,
						title: incomingValue(alert.title),
						message: incomingValue(alert.message),
						severity: incomingValue(alert.severity),
						distanceAheadM: incomingValue(alert.distanceAheadM),
						etaToHazardAt: incomingValue(alert.etaToHazardAt),
					},
				});
			for (const row of batch) {
				if (existingIncidentIds.has(row.incidentId)) result.alertsUpdated += 1;
				else {
					result.alertsCreated += 1;
					existingIncidentIds.add(row.incidentId);
				}
			}
		}
		const [resolved] = await db
			.update(alert)
			.set({
				status: "resolved",
				resolvedAt: now,
			})
			.where(
				and(
					unresolvedAlerts,
					hazards.length > 0
						? notInArray(
								alert.incidentId,
								hazards.map((hazard) => hazard.incident.id),
							)
						: undefined,
				),
			);
		result.alertsResolved = resolved.affectedRows;
		result.ok = !result.error;
	} catch {
		result.error = failureMessage;
	} finally {
		log.set({ fleet: { trips: { [trip.id]: result } } });
		if (!result.ok) log.setLevel("error");
	}
	return result;
}
