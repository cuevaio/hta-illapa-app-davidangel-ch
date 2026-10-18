import type { TripStatus } from "@hack-the-andes-project/db/schema/fleet";

export {
	DEMO_COMPANY_MAX_LENGTH_CHARS,
	DEMO_EMAIL_MAX_LENGTH_CHARS,
	DEMO_NAME_MAX_LENGTH_CHARS,
	DEMO_PHONE_MAX_LENGTH_CHARS,
} from "@hack-the-andes-project/db/schema/constants";

export const HAZARD_BUFFER_M = 500;
export const LOOKAHEAD_M = 150_000;
export const OFF_ROUTE_THRESHOLD_M = 1_000;
export const MIN_SPEED_FOR_ETA_KMH = 5;
export const DEFAULT_OSRM_BASE_URL = "https://router.project-osrm.org";
export const ALTERNATIVE_MAX_DETOUR_RATIO = 1.6;
export const KMH_TO_MPS = 1000 / 3600;
export const MS_PER_SECOND = 1000;
export const TRIP_ARRIVAL_RADIUS_M = 300;
export const METERS_PER_KM = 1000;
export const SECONDS_PER_MINUTE = 60;
export const FLEET_WRITE_BATCH_SIZE_ROWS = 250;
export const HEX_RADIX = 16;
export const HEX_BYTE_LENGTH_CHARS = 2;
export const MIN_PASSWORD_LENGTH_CHARS = 8;

export const POSITION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const POSITION_RETENTION_BATCH_SIZE_ROWS = 10_000;

export const ROUTING_REQUEST_TIMEOUT_MS = 15_000;
export const ROUTING_USER_AGENT = "illapa-fleet/1.0 (+https://illapa.app)";
export const MIN_ROUTE_COORDINATES_COUNT = 2;

export const DEMO_TRIP_SCENARIOS = ["hazard", "clear"] as const;
export const FINISHED_TRIP_STATUSES: readonly TripStatus[] = [
	"completed",
	"cancelled",
];
export const DEMO_HAZARD_MIN_DISTANCE_M = 20_000;
export const DEMO_HAZARD_MAX_DISTANCE_M = LOOKAHEAD_M;
export const DEMO_HAZARD_OVERSHOOT_M = 10_000;
export const DEMO_CLEAR_TRIP_DISTANCE_M = 60_000;
export const DEMO_CLEAR_TRIP_BEARINGS_DEG = [
	0, 45, 90, 135, 180, 225, 270, 315,
];
export const DEMO_TRIP_MIN_ROUTE_DISTANCE_M = 20_000;
export const DEMO_TRIP_MAX_ATTEMPTS_COUNT = 8;

export const MIN_ROUTE_RISK_SCORE = 0;
export const MAX_ROUTE_RISK_SCORE = 100;
export const MIN_VEHICLE_AXLE_COUNT = 2;
export const MAX_VEHICLE_AXLE_COUNT = 9;
// SUTRAN writes some limits as "hasta camiones doble eje" instead of a count.
export const DOUBLE_AXLE_TRUCK_AXLE_COUNT = 2;
export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
export const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE;
export const KG_PER_TONNE = 1_000;
export const ROUTE_REVIEW_DEPARTURE_WINDOW_MS = HOURS_PER_DAY * MS_PER_HOUR;
export const ROUTE_REVIEW_RETENTION_MS = HOURS_PER_DAY * MS_PER_HOUR;
export { VEHICLE_PLATE_LENGTH_CHARS } from "@hack-the-andes-project/db/schema/constants";
// PRD step 3: each path is split into segments of about 5 km.
export const ROUTE_REVIEW_SEGMENT_LENGTH_M = 5_000;
// Static susceptibility (0–1, risk/score.ts) from which a segment counts as
// baseline exposure: roughly mass-movement class 4 on a steep slope.
export const BASELINE_SUSCEPTIBILITY_MIN = 0.6;
// Route review routing weighs the next 24 h, the window of a departure today,
// and derives "now" from that horizon's stored components.
export const ROUTE_REVIEW_ROUTING_HORIZON_HOURS = 24;
// Share of a routed path's length on a SUTRAN detour's segments from which the
// path is listed once, as the detour.
export const DETOUR_MATCH_MIN_SHARE = 0.8;
// SUTRAN detour routing: anchors sent to OSRM through the detour, the piece
// length used to score a detour against road segments, how far a piece may be
// from a segment's midpoint to take its risk, and how close an interrupted
// tramo must run to a route for the region's detours to apply.
export const DETOUR_MAX_ANCHORS = 8;
export const DETOUR_PIECE_LENGTH_M = 1_000;
export const DETOUR_SEGMENT_MATCH_RADIUS_M = 600;
export const DETOUR_TRAMO_MATCH_RADIUS_M = 1_000;
export const DETOUR_TRAMO_SAMPLE_POINTS = 20;
// Share of a candidate's length that may lack a current assessment for it to
// still be recommended: a mostly unscored detour looks safe only for lack of
// data.
export const RECOMMENDATION_MAX_UNASSESSED_SHARE = 0.2;
// Shares of a route's length from which a road names the route (up to two)
// or is listed among its road codes; shorter urban streets are left out.
export const ROUTE_NAME_ROAD_MIN_SHARE = 0.25;
export const ROUTE_CODE_MIN_SHARE = 0.05;

export const GEOJSON_TYPE_PROPERTY = "type";
export const GEOJSON_POINT = "Point";
export const GEOJSON_MULTI_POINT = "MultiPoint";
export const GEOJSON_LINE_STRING = "LineString";
export const GEOJSON_MULTI_LINE_STRING = "MultiLineString";
export const GEOJSON_POLYGON = "Polygon";
export const GEOJSON_MULTI_POLYGON = "MultiPolygon";
export const GEOJSON_GEOMETRY_COLLECTION = "GeometryCollection";
