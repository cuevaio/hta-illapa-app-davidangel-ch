import {
	METERS_PER_KM,
	OFF_ROUTE_THRESHOLD_M,
	SECONDS_PER_MINUTE,
	TRIP_ARRIVAL_RADIUS_M,
} from "../constants";
import type { HazardAhead, RouteProgress } from "../hazards/types";
import type { ProviderPosition } from "../providers/types";

export interface TripDecision {
	arrived: boolean;
	reroute: boolean;
}

export function decideTripProgress(
	progress: RouteProgress,
	destinationDistanceM: number,
): TripDecision {
	return {
		arrived: destinationDistanceM <= TRIP_ARRIVAL_RADIUS_M,
		reroute: progress.offRouteM > OFF_ROUTE_THRESHOLD_M,
	};
}

export interface HazardAlertText {
	title: string;
	message: string;
}

export function formatHazardAlert(hazard: HazardAhead): HazardAlertText {
	const distance =
		hazard.distanceAheadM < METERS_PER_KM
			? `${Math.round(hazard.distanceAheadM)} m`
			: `${Math.round(hazard.distanceAheadM / METERS_PER_KM)} km`;
	const eta =
		hazard.etaSeconds === null
			? "ETA no disponible"
			: `ETA ${Math.ceil(hazard.etaSeconds / SECONDS_PER_MINUTE)} min`;
	return {
		title: hazard.incident.title,
		message: `${hazard.incident.title} a ${distance} (${eta})`,
	};
}

export interface StoredVehiclePosition {
	id: string;
	externalId: string | null;
	lastPositionAt: Date | null;
}

export interface VehiclePositionUpdate {
	vehicleId: string;
	position: ProviderPosition;
}

export function planPositionUpdates(
	vehicles: StoredVehiclePosition[],
	positions: ProviderPosition[],
): VehiclePositionUpdate[] {
	const latestByExternalId = new Map<string, ProviderPosition>();
	for (const position of positions) {
		const latest = latestByExternalId.get(position.externalId);
		if (!latest || position.recordedAt > latest.recordedAt) {
			latestByExternalId.set(position.externalId, position);
		}
	}
	return vehicles.flatMap((vehicle) => {
		const position =
			vehicle.externalId === null
				? undefined
				: latestByExternalId.get(vehicle.externalId);
		if (
			!position ||
			(vehicle.lastPositionAt && position.recordedAt <= vehicle.lastPositionAt)
		) {
			return [];
		}
		return [{ vehicleId: vehicle.id, position }];
	});
}
