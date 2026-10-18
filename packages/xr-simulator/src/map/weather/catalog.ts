import { parseMercatorBounds, parseUtc, type MercatorBounds } from './grid';
import { parseTimes, type TimeEntry } from './timeline';

/** The weather layers of the client (panel order) and the backend catalog (GET /api/layers). Pure. */

export type WeatherLayerId = 'clouds' | 'rain' | 'lightning' | 'cape' | 'wind' | 'temperature';
export type WeatherKind = 'observed' | 'forecast';

export interface WeatherLayerDef {
  id: WeatherLayerId;
  /** Backend layer id. */
  backend: string;
  /** Spanish title (the backend's titles are English). */
  title: string;
  kind: WeatherKind;
  /** "Tormentas" groups observed lightning and forecast CAPE (two independent sub-layers). */
  group: string | null;
  /** Default opacity 0..1. */
  opacity: number;
}

export const WEATHER_LAYERS: readonly WeatherLayerDef[] = [
  { id: 'clouds', backend: 'goes-clouds', title: 'Nubes', kind: 'observed', group: null, opacity: 0.9 },
  { id: 'rain', backend: 'gfs-precip', title: 'Lluvia', kind: 'forecast', group: null, opacity: 0.85 },
  { id: 'lightning', backend: 'glm-lightning', title: 'Rayos', kind: 'observed', group: 'Tormentas', opacity: 1 },
  { id: 'cape', backend: 'gfs-cape', title: 'Potencial convectivo', kind: 'forecast', group: 'Tormentas', opacity: 0.85 },
  { id: 'wind', backend: 'gfs-wind10m', title: 'Viento', kind: 'forecast', group: null, opacity: 0.9 },
  { id: 'temperature', backend: 'gfs-t2m', title: 'Temperatura', kind: 'forecast', group: null, opacity: 0.65 },
];

/** The four GFS layers share the forecast time axis. */
export const GFS_LAYERS: readonly WeatherLayerId[] = ['rain', 'cape', 'wind', 'temperature'];

export const KIND_LABEL: Record<WeatherKind, string> = { observed: 'observado', forecast: 'pronóstico' };

export const BACKEND_DOWN_NOTICE = 'Capas meteorológicas no disponibles: el servicio meteorológico no responde. Se reintentará en 1 min; el resto de la aplicación funciona igual.';

export const CLOUD_FALLBACK_NOTICE = 'Imagen de muestra de respaldo, no un escaneo en vivo: el servicio aún no tiene un escaneo reciente de GOES-19.';

export function layerDef(id: WeatherLayerId): WeatherLayerDef {
  return WEATHER_LAYERS.find((l) => l.id === id)!;
}

export interface CatalogEntry {
  backend: string;
  kind: WeatherKind;
  source: string;
  attribution: string;
  status: string;
  error: string | null;
  issueTime: number | null;
  obsTime: number | null;
  ageSeconds: number | null;
  fallback: boolean;
  windowMinutes: number | null;
  times: TimeEntry[];
  bounds: MercatorBounds | null;
}

export interface Catalog {
  entries: Map<string, CatalogEntry>;
  /** Shared GFS forecast axis (the temperature layer's, else the first GFS layer with times). */
  times: TimeEntry[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Validates the untrusted catalog; throws when it has no layers at all. */
export function parseCatalog(json: unknown): Catalog {
  if (!isRecord(json) || !Array.isArray(json.layers)) throw new Error('catálogo de capas no válido');
  const entries = new Map<string, CatalogEntry>();
  for (const l of json.layers) {
    if (!isRecord(l) || typeof l.id !== 'string') continue;
    const grid = isRecord(l.grid) ? l.grid : null;
    entries.set(l.id, {
      backend: l.id,
      kind: l.kind === 'observed' ? 'observed' : 'forecast',
      source: String(l.source ?? ''),
      attribution: String(l.attribution ?? ''),
      status: String(l.status ?? 'idle'),
      error: typeof l.error === 'string' ? l.error : null,
      issueTime: parseUtc(l.issueTime),
      obsTime: parseUtc(l.obsTime),
      ageSeconds: typeof l.ageSeconds === 'number' ? l.ageSeconds : null,
      fallback: l.fallback === true,
      windowMinutes: typeof l.windowMinutes === 'number' ? l.windowMinutes : null,
      times: parseTimes(l.times),
      bounds: parseMercatorBounds(grid?.mercatorBounds ?? l.mercatorBounds),
    });
  }
  if (!entries.size) throw new Error('el catálogo no tiene capas');
  const axis = [layerDef('temperature'), ...GFS_LAYERS.map(layerDef)].map((d) => entries.get(d.backend)?.times ?? []).find((t) => t.length) ?? [];
  return { entries, times: axis };
}

/** "Nubes: X · Temperatura, Viento: NOAA/NCEP Global Forecast System" (layers with the same credit share it). */
export function attributionLine(items: { title: string; attribution: string }[]): string | null {
  const groups = new Map<string, string[]>();
  for (const i of items) if (i.attribution) groups.set(i.attribution, [...(groups.get(i.attribution) ?? []), i.title]);
  if (!groups.size) return null;
  return [...groups].map(([credit, titles]) => `${titles.join(', ')}: ${credit}`).join(' · ');
}
