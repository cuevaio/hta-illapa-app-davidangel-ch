import type { UserRole } from "@hack-the-andes-project/db/schema/auth";

// The civil engineer / public servant role: the only one allowed into the
// huayco and structures simulators and their tiles and weather backends.
export const SIMULATOR_ROLE: UserRole = "engineer";

export const TILES_API_PATH = "/tiles-api";
export const WEATHER_API_PATH = "/weather-api";

// The viewer reads each tile's metadata from these headers; browsers hide them
// on the web app's cross-origin requests unless CORS exposes them.
export const TILE_METADATA_HEADERS = [
	"X-Tile-Min",
	"X-Tile-Max",
	"X-Tile-Source",
	"X-Tile-Version",
	"X-Tile-Date",
	"X-Tile-Overzoom",
];

export function canUseSimulators(role: string | null | undefined) {
	return role === SIMULATOR_ROLE;
}
