import type { UserRole } from "@hack-the-andes-project/db/schema/auth";

// The civil engineer / public servant role: the only one allowed into the
// huayco and structures simulators and their tiles and weather backends.
export const SIMULATOR_ROLE: UserRole = "engineer";

export const TILES_API_PATH = "/tiles-api";
export const WEATHER_API_PATH = "/weather-api";

export function canUseSimulators(role: string | null | undefined) {
	return role === SIMULATOR_ROLE;
}
