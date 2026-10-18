import type { DemoVehicle } from "./types";

export const GEOTAB_DEFAULT_SERVER = "my.geotab.com";
export const GEOTAB_API_PATH = "/apiv1";
export const GEOTAB_SAME_SERVER_PATH = "ThisServer";
export const GEOTAB_VALIDATION_RESULTS_LIMIT = 1;

export const SAMSARA_API_BASE_URL = "https://api.samsara.com";

export const KMH_PER_MPH = 1.609344;

export const PROVIDER_REQUEST_TIMEOUT_MS = 15_000;
export const PROVIDER_MAX_PAGES_COUNT = 100;
export const GEOTAB_AUTH_ATTEMPTS_COUNT = 2;
export const SAMSARA_VALIDATION_LIMIT_ROWS = 1;

export const DEMO_TIME_ACCELERATION_FACTOR = 10;
export const DEMO_HEADING_LOOKAHEAD_M = 50;
export const FULL_TURN_DEG = 360;
export const DEMO_CLEAR_VEHICLE_EXTERNAL_ID = "demo-trujillo";
export const DEMO_VEHICLES: DemoVehicle[] = [
	{
		externalId: "demo-callao",
		vehicleTypeId: "t2s3",
		name: "Tracto 01 · Callao",
		plate: "DEM-101",
		depot: { lat: -12.0553, lng: -77.118 },
	},
	{
		externalId: "demo-ate",
		vehicleTypeId: "t3s3",
		name: "Tracto 02 · Ate",
		plate: "DEM-102",
		depot: { lat: -12.026, lng: -76.918 },
	},
	{
		externalId: "demo-lurin",
		vehicleTypeId: "t2s3",
		name: "Tracto 03 · Lurín",
		plate: "DEM-103",
		depot: { lat: -12.274, lng: -76.871 },
	},
	{
		externalId: "demo-trujillo",
		vehicleTypeId: "t3s3",
		name: "Tracto 04 · Trujillo",
		plate: "DEM-104",
		depot: { lat: -8.109, lng: -79.0215 },
	},
	{
		externalId: "demo-huancayo",
		vehicleTypeId: "t2s3",
		name: "Tracto 05 · Huancayo",
		plate: "DEM-105",
		depot: { lat: -12.0651, lng: -75.2049 },
	},
	{
		externalId: "demo-arequipa",
		vehicleTypeId: "t3s3",
		name: "Tracto 06 · Arequipa",
		plate: "DEM-106",
		depot: { lat: -16.409, lng: -71.5375 },
	},
];
