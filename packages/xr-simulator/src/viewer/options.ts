import { tilesBaseUrl } from "../map/tilesClient";
import { WEATHER_API_BASE } from "../map/weather/weatherApi";

/** Where the viewer reaches the tiles and weather backends, and with which fetch credentials. */
export interface XrViewerEndpoints {
	tilesBaseUrl: string;
	weatherBaseUrl: string;
	credentials: RequestCredentials;
}

export type XrViewerEndpointOptions = Partial<XrViewerEndpoints>;

const withoutTrailingSlash = (url: string) => url.replace(/\/+$/, "");

/**
 * Standalone dev page: same-origin Vite proxies (`/tiles-api`, `/weather-api`, or VITE_TILES_URL).
 * Embedded in another app: its backend proxies, e.g. cross-origin with `credentials: 'include'`.
 */
export function resolveEndpoints(
	options: XrViewerEndpointOptions,
	env: { VITE_TILES_URL?: string },
): XrViewerEndpoints {
	return {
		tilesBaseUrl: options.tilesBaseUrl
			? withoutTrailingSlash(options.tilesBaseUrl)
			: tilesBaseUrl(env),
		weatherBaseUrl: withoutTrailingSlash(
			options.weatherBaseUrl ?? WEATHER_API_BASE,
		),
		credentials: options.credentials ?? "same-origin",
	};
}
