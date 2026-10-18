import {
	geometrySchema as businessGeometrySchema,
	lineStringSchema,
} from "@hack-the-andes-project/business/geojson-schemas";
import {
	ID_LENGTH_CHARS,
	TEXT_LENGTH_CHARS,
} from "@hack-the-andes-project/db/schema/constants";
import {
	ALERT_KINDS,
	ALERT_STATUSES,
	CONNECTION_STATUSES,
	GPS_PROVIDERS,
	TRIP_STATUSES,
} from "@hack-the-andes-project/db/schema/fleet";
import {
	INCIDENT_CATEGORIES,
	INCIDENT_SEVERITIES,
} from "@hack-the-andes-project/db/schema/scraper";
import type { Geometry } from "geojson";
import { z } from "zod";

import {
	INVALID_BOUNDING_BOX_MESSAGE,
	MAX_LATITUDE_DEG,
	MAX_LONGITUDE_DEG,
	MIN_FLEET_TEXT_LENGTH_CHARS,
	MIN_LATITUDE_DEG,
	MIN_LONGITUDE_DEG,
} from "./constants";

export const geometrySchema: z.ZodType<Geometry> = businessGeometrySchema;
export { lineStringSchema };

const latitudeSchema = z.number().min(MIN_LATITUDE_DEG).max(MAX_LATITUDE_DEG);
const longitudeSchema = z
	.number()
	.min(MIN_LONGITUDE_DEG)
	.max(MAX_LONGITUDE_DEG);

export const latLngSchema = z.object({
	lat: latitudeSchema,
	lng: longitudeSchema,
});

export const fleetIdSchema = z
	.string()
	.min(MIN_FLEET_TEXT_LENGTH_CHARS)
	.max(ID_LENGTH_CHARS);
export const entityIdInputSchema = z.object({ id: fleetIdSchema });
export const fleetNameSchema = z
	.string()
	.min(MIN_FLEET_TEXT_LENGTH_CHARS)
	.max(TEXT_LENGTH_CHARS);

export const boundingBoxSchema = z
	.object({
		west: longitudeSchema,
		south: latitudeSchema,
		east: longitudeSchema,
		north: latitudeSchema,
	})
	.refine(
		(boundingBox) =>
			boundingBox.west <= boundingBox.east &&
			boundingBox.south <= boundingBox.north,
		{ message: INVALID_BOUNDING_BOX_MESSAGE },
	);

export const connectionSummarySchema = z.object({
	id: z.string(),
	provider: z.enum(GPS_PROVIDERS),
	label: z.string(),
	status: z.enum(CONNECTION_STATUSES),
	lastSyncAt: z.date().nullable(),
	lastError: z.string().nullable(),
	vehicleCount: z.number().int().nonnegative(),
	createdAt: z.date(),
});

export const activeTripSchema = z.object({
	id: z.string(),
	name: z.string(),
	destinationName: z.string(),
	etaAt: z.date().nullable(),
	status: z.enum(TRIP_STATUSES),
});

export const tripStatusSchema = z.object({
	id: z.string(),
	status: z.enum(TRIP_STATUSES),
});

export const vehicleSummarySchema = z.object({
	id: z.string(),
	organizationId: z.string(),
	connectionId: z.string().nullable(),
	externalId: z.string().nullable(),
	name: z.string(),
	plate: z.string().nullable(),
	lastLat: latitudeSchema.nullable(),
	lastLng: longitudeSchema.nullable(),
	lastHeading: z.number().nullable(),
	lastSpeedKmh: z.number().nullable(),
	lastPositionAt: z.date().nullable(),
	active: z.boolean(),
	createdAt: z.date(),
	updatedAt: z.date(),
	provider: z.enum(GPS_PROVIDERS).nullable(),
	activeTrip: activeTripSchema.nullable(),
});

export const tripSchema = z.object({
	id: z.string(),
	organizationId: z.string(),
	vehicleId: z.string(),
	name: z.string(),
	originLat: latitudeSchema,
	originLng: longitudeSchema,
	destinationLat: latitudeSchema,
	destinationLng: longitudeSchema,
	destinationName: z.string(),
	routeGeometry: lineStringSchema,
	routeDistanceM: z.number().nonnegative(),
	routeDurationS: z.number().nonnegative(),
	status: z.enum(TRIP_STATUSES),
	etaAt: z.date().nullable(),
	lastEvaluatedAt: z.date().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

export const tripSummarySchema = tripSchema.extend({
	vehicleName: z.string().nullable(),
	openAlertCount: z.number().int().nonnegative(),
});

export const alertSummarySchema = z.object({
	id: z.string(),
	organizationId: z.string(),
	tripId: z.string(),
	vehicleId: z.string(),
	incidentId: z.string(),
	kind: z.enum(ALERT_KINDS),
	severity: z.enum(INCIDENT_SEVERITIES),
	title: z.string(),
	message: z.string(),
	distanceAheadM: z.number(),
	etaToHazardAt: z.date().nullable(),
	alternativeRoute: z
		.object({
			geometry: lineStringSchema,
			distanceM: z.number().nonnegative(),
			durationS: z.number().nonnegative(),
		})
		.nullable(),
	status: z.enum(ALERT_STATUSES),
	createdAt: z.date(),
	acknowledgedAt: z.date().nullable(),
	resolvedAt: z.date().nullable(),
	tripName: z.string().nullable(),
	vehicleName: z.string().nullable(),
	incident: z
		.object({
			id: z.string(),
			title: z.string(),
			category: z.enum(INCIDENT_CATEGORIES),
			geometry: geometrySchema.nullable(),
			lat: latitudeSchema.nullable(),
			lng: longitudeSchema.nullable(),
		})
		.nullable(),
});
