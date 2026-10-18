import type { WeatherApi } from './WeatherController';

/**
 * HTTP client of services/weather: through the Vite proxy (`/weather-api` → WEATHER_API_URL) on the
 * standalone page, or through the host app's backend proxy (src/viewer/options.ts).
 * Every request has a timeout, so a stopped backend fails fast instead of hanging the layers.
 */
export const WEATHER_API_BASE = '/weather-api';

const JSON_TIMEOUT_MS = 8000;
const BINARY_TIMEOUT_MS = 20_000;

async function get(url: string, timeoutMs: number, credentials: RequestCredentials): Promise<Response> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), credentials });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

export function httpWeatherApi(base = WEATHER_API_BASE, credentials: RequestCredentials = 'same-origin'): WeatherApi {
  const api = `${base}/api`;
  const json = async (path: string) => (await get(`${api}${path}`, JSON_TIMEOUT_MS, credentials)).json() as Promise<unknown>;
  return {
    catalog: () => json('/layers'),
    meta: (layer, time) => json(`/layers/${encodeURIComponent(layer)}/${encodeURIComponent(time)}/meta`),
    grid: async (layer, time) => (await get(`${api}/layers/${encodeURIComponent(layer)}/${encodeURIComponent(time)}/grid`, BINARY_TIMEOUT_MS, credentials)).arrayBuffer(),
    point: (layer, lat, lon, time) => json(`/layers/${encodeURIComponent(layer)}/point?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&time=${encodeURIComponent(time)}`),
    lightning: () => json('/lightning'),
    clouds: () => json('/clouds'),
    // imagePath is relative to the API base ("/api/clouds/image?scan=…"), validated by parseCloudMeta.
    cloudImage: async (path) => (await get(`${base}${path}`, BINARY_TIMEOUT_MS, credentials)).blob(),
  };
}

/** Decodes the grey + alpha cloud PNG, downscaled to at most `maxWidth` px (Quest budget). */
export function cloudDecoder(maxWidth: number): (blob: Blob) => Promise<ImageBitmap> {
  return async (blob) => {
    const full = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    if (full.width <= maxWidth) return full;
    const h = Math.round((full.height * maxWidth) / full.width);
    const small = await createImageBitmap(full, { resizeWidth: maxWidth, resizeHeight: h, resizeQuality: 'high', premultiplyAlpha: 'none' });
    full.close();
    return small;
  };
}
