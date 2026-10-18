import {
	INCIDENT_SEVERITIES,
	type IncidentSeverity,
} from "@hack-the-andes-project/db/schema/scraper";
import { bbox } from "@turf/bbox";
import { buffer } from "@turf/buffer";
import { distance } from "@turf/distance";
import { point } from "@turf/helpers";

import type { LatLng } from "../hazards/types";
import { STRUCTURE_EXPOSURE_RADIUS_M } from "./constants";

export interface ExposureBounds {
	west: number;
	south: number;
	east: number;
	north: number;
}

export interface ExposureIncident {
	id: string;
	lat: number | null;
	lng: number | null;
	severity: IncidentSeverity;
	validUntil?: Date | null;
}

export interface StructureExposure<Incident extends ExposureIncident> {
	incident: Incident;
	distanceM: number;
	point: LatLng;
}

export function structureExposureBounds(
	anchor: LatLng,
	radiusM = STRUCTURE_EXPOSURE_RADIUS_M,
): ExposureBounds {
	const anchorPoint = point([anchor.lng, anchor.lat]);
	const bounds = bbox(
		buffer(anchorPoint, radiusM, { units: "meters" }) ?? anchorPoint,
	);
	return {
		west: bounds[0],
		south: bounds[1],
		east: bounds[2],
		north: bounds[3],
	};
}

export function structureExposure<Incident extends ExposureIncident>(
	anchor: LatLng,
	incidents: Incident[],
	radiusM = STRUCTURE_EXPOSURE_RADIUS_M,
	now = new Date(),
): StructureExposure<Incident>[] {
	const nearby: StructureExposure<Incident>[] = [];
	for (const incident of incidents) {
		if (incident.lat === null || incident.lng === null) continue;
		if (incident.validUntil && incident.validUntil <= now) continue;
		const distanceM = distance(
			[anchor.lng, anchor.lat],
			[incident.lng, incident.lat],
			{ units: "meters" },
		);
		if (distanceM <= radiusM)
			nearby.push({
				incident,
				distanceM,
				point: { lat: incident.lat, lng: incident.lng },
			});
	}
	return nearby.sort(
		(first, second) =>
			INCIDENT_SEVERITIES.indexOf(second.incident.severity) -
				INCIDENT_SEVERITIES.indexOf(first.incident.severity) ||
			first.distanceM - second.distanceM,
	);
}
