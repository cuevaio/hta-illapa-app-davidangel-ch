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
import type { Geometry } from "geojson";

import { mysqlTable } from "./_table";

export const INCIDENT_CATEGORIES = [
	"road_accident",
	"road_works",
	"road_block",
	"landslide",
	"flood",
	"fire",
	"wildfire",
	"earthquake",
	"weather",
	"medical",
	"rescue",
	"hazmat",
	"rain_warning",
	"flood_warning",
	"other",
] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export const INCIDENT_SEVERITIES = ["info", "warning", "critical"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const ROAD_STATUSES = ["interrumpido", "restringido", "normal"] as const;
export type RoadStatus = (typeof ROAD_STATUSES)[number];

export const POI_KINDS = [
	"alt_route",
	"fire_station",
	"police_station",
	"health_facility",
	"bus_terminal",
	"weighing_station",
	"relief_warehouse",
] as const;
export type PoiKind = (typeof POI_KINDS)[number];

// `geometry` is the upstream GeoJSON geometry (WGS84, [lng, lat]) so consumers
// can run Turf operations on it directly; `lat`/`lng` is its centroid for
// cheap bounding-box queries.
// Rows are keyed by (source, sourceId) so every scrape run upserts in place.
// `active` flips to false when a successful run no longer sees the record,
// `lastChangedAt` only moves when the hashed content differs, so alerting can
// poll "active rows changed since X" cheaply.
export const incident = mysqlTable(
	"incident",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		source: varchar("source", { length: 64 }).notNull(),
		sourceId: varchar("source_id", { length: 128 }).notNull(),
		category: varchar("category", { length: 32 })
			.$type<IncidentCategory>()
			.notNull(),
		severity: varchar("severity", { length: 16 })
			.$type<IncidentSeverity>()
			.notNull(),
		title: varchar("title", { length: 512 }).notNull(),
		description: text("description"),
		imageUrl: varchar("image_url", { length: 1024 }),
		status: varchar("status", { length: 64 }),
		roadStatus: varchar("road_status", { length: 32 }).$type<RoadStatus>(),
		roadCode: varchar("road_code", { length: 32 }),
		roadName: varchar("road_name", { length: 255 }),
		roadKm: varchar("road_km", { length: 64 }),
		lat: double("lat"),
		lng: double("lng"),
		geometry: json("geometry").$type<Geometry>(),
		region: varchar("region", { length: 128 }),
		provincia: varchar("provincia", { length: 128 }),
		distrito: varchar("distrito", { length: 128 }),
		occurredAt: timestamp("occurred_at", { fsp: 3 }),
		sourceUpdatedAt: timestamp("source_updated_at", { fsp: 3 }),
		validFrom: timestamp("valid_from", { fsp: 3 }),
		validUntil: timestamp("valid_until", { fsp: 3 }),
		attributes: json("attributes").$type<Record<string, unknown>>().notNull(),
		contentHash: varchar("content_hash", { length: 64 }).notNull(),
		active: boolean("active").default(true).notNull(),
		firstSeenAt: timestamp("first_seen_at", { fsp: 3 }).notNull(),
		lastSeenAt: timestamp("last_seen_at", { fsp: 3 }).notNull(),
		lastChangedAt: timestamp("last_changed_at", { fsp: 3 }).notNull(),
	},
	(table) => [
		uniqueIndex("incident_source_sourceId_idx").on(
			table.source,
			table.sourceId,
		),
		index("incident_active_lastChangedAt_idx").on(
			table.active,
			table.lastChangedAt,
		),
		index("incident_category_idx").on(table.category),
		index("incident_lat_lng_idx").on(table.lat, table.lng),
	],
);

export const poi = mysqlTable(
	"poi",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		source: varchar("source", { length: 64 }).notNull(),
		sourceId: varchar("source_id", { length: 128 }).notNull(),
		kind: varchar("kind", { length: 32 }).$type<PoiKind>().notNull(),
		name: varchar("name", { length: 512 }).notNull(),
		lat: double("lat"),
		lng: double("lng"),
		geometry: json("geometry").$type<Geometry>(),
		region: varchar("region", { length: 128 }),
		provincia: varchar("provincia", { length: 128 }),
		distrito: varchar("distrito", { length: 128 }),
		roadCodes: json("road_codes").$type<string[]>(),
		attributes: json("attributes").$type<Record<string, unknown>>().notNull(),
		contentHash: varchar("content_hash", { length: 64 }).notNull(),
		active: boolean("active").default(true).notNull(),
		firstSeenAt: timestamp("first_seen_at", { fsp: 3 }).notNull(),
		lastSeenAt: timestamp("last_seen_at", { fsp: 3 }).notNull(),
		lastChangedAt: timestamp("last_changed_at", { fsp: 3 }).notNull(),
	},
	(table) => [
		uniqueIndex("poi_source_sourceId_idx").on(table.source, table.sourceId),
		index("poi_kind_idx").on(table.kind),
		index("poi_lat_lng_idx").on(table.lat, table.lng),
	],
);

// Every article seen on a news listing, classified once by Jev (TypeSafe)
// when first stored. `relevant` rows are mirrored into `incident` under the
// same source so route-conflict consumers only read one table.
export const newsArticle = mysqlTable(
	"news_article",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		source: varchar("source", { length: 64 }).notNull(),
		sourceId: varchar("source_id", { length: 128 }).notNull(),
		url: varchar("url", { length: 1024 }).notNull(),
		title: varchar("title", { length: 512 }).notNull(),
		excerpt: text("excerpt"),
		section: varchar("section", { length: 128 }),
		author: varchar("author", { length: 255 }),
		publishedAt: timestamp("published_at", { fsp: 3 }),
		relevant: boolean("relevant").notNull(),
		relevance: double("relevance").notNull(),
		category: varchar("category", { length: 32 }).$type<IncidentCategory>(),
		severity: varchar("severity", { length: 16 }).$type<IncidentSeverity>(),
		region: varchar("region", { length: 128 }),
		classification: json("classification")
			.$type<Record<string, unknown>>()
			.notNull(),
		contentHash: varchar("content_hash", { length: 64 }).notNull(),
		active: boolean("active").default(true).notNull(),
		firstSeenAt: timestamp("first_seen_at", { fsp: 3 }).notNull(),
		lastSeenAt: timestamp("last_seen_at", { fsp: 3 }).notNull(),
		lastChangedAt: timestamp("last_changed_at", { fsp: 3 }).notNull(),
	},
	(table) => [
		uniqueIndex("newsArticle_source_sourceId_idx").on(
			table.source,
			table.sourceId,
		),
		index("newsArticle_relevant_publishedAt_idx").on(
			table.relevant,
			table.publishedAt,
		),
		index("newsArticle_publishedAt_idx").on(table.publishedAt),
	],
);

export const scrapeRun = mysqlTable(
	"scrape_run",
	{
		id: varchar("id", { length: 36 }).primaryKey(),
		source: varchar("source", { length: 64 }).notNull(),
		startedAt: timestamp("started_at", { fsp: 3 }).notNull(),
		finishedAt: timestamp("finished_at", { fsp: 3 }).notNull(),
		ok: boolean("ok").notNull(),
		fetched: int("fetched").default(0).notNull(),
		inserted: int("inserted").default(0).notNull(),
		updated: int("updated").default(0).notNull(),
		deactivated: int("deactivated").default(0).notNull(),
		errorMessage: text("error_message"),
	},
	(table) => [
		index("scrapeRun_source_startedAt_idx").on(table.source, table.startedAt),
	],
);
