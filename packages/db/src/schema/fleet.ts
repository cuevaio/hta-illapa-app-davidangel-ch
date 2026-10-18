import { defineRelationsPart } from "drizzle-orm";
import {
	boolean,
	double,
	index,
	int,
	json,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from "drizzle-orm/mysql-core";
import type { LineString } from "geojson";

import { mysqlTable } from "./_table";
import { organization } from "./auth";
import {
	ID_LENGTH_CHARS,
	PROVIDER_LENGTH_CHARS,
	SEVERITY_LENGTH_CHARS,
	STATUS_LENGTH_CHARS,
	TEXT_LENGTH_CHARS,
	TIMESTAMP_PRECISION_DIGITS,
	TITLE_LENGTH_CHARS,
	VEHICLE_PLATE_LENGTH_CHARS,
} from "./constants";
import { type IncidentSeverity, incident } from "./scraper";

export const GPS_PROVIDERS = ["geotab", "samsara", "demo"] as const;
export type GpsProvider = (typeof GPS_PROVIDERS)[number];

export const CONNECTION_STATUSES = ["active", "error"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const TRIP_STATUSES = [
	"planned",
	"active",
	"completed",
	"cancelled",
] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const ALERT_STATUSES = ["open", "acknowledged", "resolved"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const ALERT_KINDS = ["hazard_ahead"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export interface AlternativeRoute {
	geometry: LineString;
	distanceM: number;
	durationS: number;
}

export const gpsConnection = mysqlTable(
	"gps_connection",
	{
		id: varchar("id", { length: ID_LENGTH_CHARS }).primaryKey(),
		organizationId: varchar("organization_id", {
			length: ID_LENGTH_CHARS,
		}).notNull(),
		provider: varchar("provider", { length: PROVIDER_LENGTH_CHARS })
			.$type<GpsProvider>()
			.notNull(),
		label: varchar("label", { length: TEXT_LENGTH_CHARS }).notNull(),
		encryptedCredentials: text("encrypted_credentials").notNull(),
		status: varchar("status", { length: STATUS_LENGTH_CHARS })
			.$type<ConnectionStatus>()
			.default("active")
			.notNull(),
		lastSyncAt: timestamp("last_sync_at", { fsp: TIMESTAMP_PRECISION_DIGITS }),
		lastError: text("last_error"),
		createdAt: timestamp("created_at", { fsp: TIMESTAMP_PRECISION_DIGITS })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { fsp: TIMESTAMP_PRECISION_DIGITS })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("gpsConnection_organizationId_idx").on(table.organizationId),
	],
);

export const vehicle = mysqlTable(
	"vehicle",
	{
		id: varchar("id", { length: ID_LENGTH_CHARS }).primaryKey(),
		organizationId: varchar("organization_id", {
			length: ID_LENGTH_CHARS,
		}).notNull(),
		connectionId: varchar("connection_id", { length: ID_LENGTH_CHARS }),
		externalId: varchar("external_id", { length: TEXT_LENGTH_CHARS }),
		vehicleTypeId: varchar("vehicle_type_id", { length: TEXT_LENGTH_CHARS }),
		axleCount: int("axle_count"),
		grossWeightKg: double("gross_weight_kg"),
		name: varchar("name", { length: TEXT_LENGTH_CHARS }).notNull(),
		plate: varchar("plate", { length: VEHICLE_PLATE_LENGTH_CHARS }),
		lastLat: double("last_lat"),
		lastLng: double("last_lng"),
		lastHeading: double("last_heading"),
		lastSpeedKmh: double("last_speed_kmh"),
		lastPositionAt: timestamp("last_position_at", {
			fsp: TIMESTAMP_PRECISION_DIGITS,
		}),
		active: boolean("active").default(true).notNull(),
		createdAt: timestamp("created_at", { fsp: TIMESTAMP_PRECISION_DIGITS })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { fsp: TIMESTAMP_PRECISION_DIGITS })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("vehicle_connectionId_externalId_idx").on(
			table.connectionId,
			table.externalId,
		),
		index("vehicle_organizationId_idx").on(table.organizationId),
	],
);

export const vehiclePosition = mysqlTable(
	"vehicle_position",
	{
		id: varchar("id", { length: ID_LENGTH_CHARS }).primaryKey(),
		vehicleId: varchar("vehicle_id", { length: ID_LENGTH_CHARS }).notNull(),
		lat: double("lat").notNull(),
		lng: double("lng").notNull(),
		speedKmh: double("speed_kmh"),
		heading: double("heading"),
		recordedAt: timestamp("recorded_at", {
			fsp: TIMESTAMP_PRECISION_DIGITS,
		}).notNull(),
	},
	(table) => [
		index("vehiclePosition_recordedAt_idx").on(table.recordedAt),
		index("vehiclePosition_vehicleId_recordedAt_idx").on(
			table.vehicleId,
			table.recordedAt,
		),
	],
);

export const routeReview = mysqlTable(
	"route_review",
	{
		id: varchar("id", { length: ID_LENGTH_CHARS }).primaryKey(),
		organizationId: varchar("organization_id", {
			length: ID_LENGTH_CHARS,
		}).notNull(),
		vehicleId: varchar("vehicle_id", { length: ID_LENGTH_CHARS }).notNull(),
		originPlaceId: varchar("origin_place_id", {
			length: TEXT_LENGTH_CHARS,
		}).notNull(),
		destinationPlaceId: varchar("destination_place_id", {
			length: TEXT_LENGTH_CHARS,
		}).notNull(),
		departureAt: timestamp("departure_at", {
			fsp: TIMESTAMP_PRECISION_DIGITS,
		}).notNull(),
		review: json("review").$type<unknown>().notNull(),
		evaluatedAt: timestamp("evaluated_at", {
			fsp: TIMESTAMP_PRECISION_DIGITS,
		}).notNull(),
		createdAt: timestamp("created_at", { fsp: TIMESTAMP_PRECISION_DIGITS })
			.defaultNow()
			.notNull(),
	},
	(table) => [index("routeReview_organizationId_idx").on(table.organizationId)],
);

export const trip = mysqlTable(
	"trip",
	{
		id: varchar("id", { length: ID_LENGTH_CHARS }).primaryKey(),
		organizationId: varchar("organization_id", {
			length: ID_LENGTH_CHARS,
		}).notNull(),
		vehicleId: varchar("vehicle_id", { length: ID_LENGTH_CHARS }).notNull(),
		reviewId: varchar("review_id", { length: ID_LENGTH_CHARS }),
		chosenCandidate: json("chosen_candidate").$type<unknown>(),
		chosenCandidateId: varchar("chosen_candidate_id", {
			length: TEXT_LENGTH_CHARS,
		}),
		originPlaceId: varchar("origin_place_id", { length: TEXT_LENGTH_CHARS }),
		destinationPlaceId: varchar("destination_place_id", {
			length: TEXT_LENGTH_CHARS,
		}),
		departureAt: timestamp("departure_at", { fsp: TIMESTAMP_PRECISION_DIGITS }),
		startedAt: timestamp("started_at", { fsp: TIMESTAMP_PRECISION_DIGITS }),
		name: varchar("name", { length: TEXT_LENGTH_CHARS }).notNull(),
		originLat: double("origin_lat").notNull(),
		originLng: double("origin_lng").notNull(),
		destinationLat: double("destination_lat").notNull(),
		destinationLng: double("destination_lng").notNull(),
		destinationName: varchar("destination_name", {
			length: TEXT_LENGTH_CHARS,
		}).notNull(),
		routeGeometry: json("route_geometry").$type<LineString>().notNull(),
		routeDistanceM: double("route_distance_m").notNull(),
		routeDurationS: double("route_duration_s").notNull(),
		status: varchar("status", { length: STATUS_LENGTH_CHARS })
			.$type<TripStatus>()
			.default("active")
			.notNull(),
		etaAt: timestamp("eta_at", { fsp: TIMESTAMP_PRECISION_DIGITS }),
		lastEvaluatedAt: timestamp("last_evaluated_at", {
			fsp: TIMESTAMP_PRECISION_DIGITS,
		}),
		createdAt: timestamp("created_at", { fsp: TIMESTAMP_PRECISION_DIGITS })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { fsp: TIMESTAMP_PRECISION_DIGITS })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("trip_organizationId_status_idx").on(
			table.organizationId,
			table.status,
		),
		index("trip_vehicleId_idx").on(table.vehicleId),
	],
);

export const alert = mysqlTable(
	"alert",
	{
		id: varchar("id", { length: ID_LENGTH_CHARS }).primaryKey(),
		organizationId: varchar("organization_id", {
			length: ID_LENGTH_CHARS,
		}).notNull(),
		tripId: varchar("trip_id", { length: ID_LENGTH_CHARS }).notNull(),
		vehicleId: varchar("vehicle_id", { length: ID_LENGTH_CHARS }).notNull(),
		incidentId: varchar("incident_id", { length: ID_LENGTH_CHARS }).notNull(),
		kind: varchar("kind", { length: STATUS_LENGTH_CHARS })
			.$type<AlertKind>()
			.default("hazard_ahead")
			.notNull(),
		severity: varchar("severity", { length: SEVERITY_LENGTH_CHARS })
			.$type<IncidentSeverity>()
			.notNull(),
		title: varchar("title", { length: TITLE_LENGTH_CHARS }).notNull(),
		message: text("message").notNull(),
		distanceAheadM: double("distance_ahead_m").notNull(),
		etaToHazardAt: timestamp("eta_to_hazard_at", {
			fsp: TIMESTAMP_PRECISION_DIGITS,
		}),
		alternativeRoute: json("alternative_route").$type<AlternativeRoute>(),
		status: varchar("status", { length: STATUS_LENGTH_CHARS })
			.$type<AlertStatus>()
			.default("open")
			.notNull(),
		createdAt: timestamp("created_at", { fsp: TIMESTAMP_PRECISION_DIGITS })
			.defaultNow()
			.notNull(),
		acknowledgedAt: timestamp("acknowledged_at", {
			fsp: TIMESTAMP_PRECISION_DIGITS,
		}),
		resolvedAt: timestamp("resolved_at", { fsp: TIMESTAMP_PRECISION_DIGITS }),
	},
	(table) => [
		uniqueIndex("alert_tripId_incidentId_idx").on(
			table.tripId,
			table.incidentId,
		),
		index("alert_organizationId_status_idx").on(
			table.organizationId,
			table.status,
		),
		index("alert_vehicleId_idx").on(table.vehicleId),
		index("alert_incidentId_idx").on(table.incidentId),
	],
);

export const fleetRelations = defineRelationsPart(
	{
		organization,
		gpsConnection,
		vehicle,
		vehiclePosition,
		trip,
		alert,
		incident,
	},
	(relations) => ({
		organization: {
			connections: relations.many.gpsConnection({
				from: relations.organization.id,
				to: relations.gpsConnection.organizationId,
			}),
			vehicles: relations.many.vehicle({
				from: relations.organization.id,
				to: relations.vehicle.organizationId,
			}),
			trips: relations.many.trip({
				from: relations.organization.id,
				to: relations.trip.organizationId,
			}),
			alerts: relations.many.alert({
				from: relations.organization.id,
				to: relations.alert.organizationId,
			}),
		},
		gpsConnection: {
			organization: relations.one.organization({
				from: relations.gpsConnection.organizationId,
				to: relations.organization.id,
			}),
			vehicles: relations.many.vehicle({
				from: relations.gpsConnection.id,
				to: relations.vehicle.connectionId,
			}),
		},
		vehicle: {
			organization: relations.one.organization({
				from: relations.vehicle.organizationId,
				to: relations.organization.id,
			}),
			connection: relations.one.gpsConnection({
				from: relations.vehicle.connectionId,
				to: relations.gpsConnection.id,
			}),
			positions: relations.many.vehiclePosition({
				from: relations.vehicle.id,
				to: relations.vehiclePosition.vehicleId,
			}),
			trips: relations.many.trip({
				from: relations.vehicle.id,
				to: relations.trip.vehicleId,
			}),
			alerts: relations.many.alert({
				from: relations.vehicle.id,
				to: relations.alert.vehicleId,
			}),
		},
		vehiclePosition: {
			vehicle: relations.one.vehicle({
				from: relations.vehiclePosition.vehicleId,
				to: relations.vehicle.id,
			}),
		},
		trip: {
			organization: relations.one.organization({
				from: relations.trip.organizationId,
				to: relations.organization.id,
			}),
			vehicle: relations.one.vehicle({
				from: relations.trip.vehicleId,
				to: relations.vehicle.id,
			}),
			alerts: relations.many.alert({
				from: relations.trip.id,
				to: relations.alert.tripId,
			}),
		},
		alert: {
			organization: relations.one.organization({
				from: relations.alert.organizationId,
				to: relations.organization.id,
			}),
			trip: relations.one.trip({
				from: relations.alert.tripId,
				to: relations.trip.id,
			}),
			vehicle: relations.one.vehicle({
				from: relations.alert.vehicleId,
				to: relations.vehicle.id,
			}),
			incident: relations.one.incident({
				from: relations.alert.incidentId,
				to: relations.incident.id,
			}),
		},
	}),
);
