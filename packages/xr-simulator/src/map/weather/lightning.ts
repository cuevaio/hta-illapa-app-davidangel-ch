import { EARTH_RADIUS, lonLatToMercator, parseUtc } from "./grid";
import { formatAge, formatUtcClock } from "./timeline";

/**
 * Observed lightning (GOES-19 GLM flashes, GET /api/lightning): a rolling window ending now,
 * independent of the forecast timeline (after peru-simulator's src/domain/lightning.ts). Pure.
 * Ages are measured against the wall clock, so markers keep ageing between polls.
 */
export interface LightningData {
	windowMinutes: number;
	windowEnd: number;
	obsTime: number | null;
	coverageStart: number | null;
	status: string;
	count: number;
	lat: Float64Array;
	lon: Float64Array;
	/** Flash time (first optical event), epoch ms. */
	time: Float64Array;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null;
const finite = (v: unknown): v is number =>
	typeof v === "number" && Number.isFinite(v);

/** Validates the untrusted JSON; flashes with non-finite fields are dropped. */
export function parseLightning(json: unknown): LightningData | null {
	if (!isRecord(json) || !isRecord(json.flashes)) return null;
	const windowEnd = parseUtc(json.windowEnd);
	if (
		windowEnd === null ||
		!finite(json.windowMinutes) ||
		json.windowMinutes <= 0
	)
		return null;
	const { lat, lon, age } = json.flashes;
	if (!Array.isArray(lat) || !Array.isArray(lon) || !Array.isArray(age))
		return null;
	const la: number[] = [];
	const lo: number[] = [];
	const t: number[] = [];
	const n = Math.min(lat.length, lon.length, age.length);
	for (let i = 0; i < n; i++) {
		if (!finite(lat[i]) || !finite(lon[i]) || !finite(age[i])) continue;
		la.push(lat[i]);
		lo.push(lon[i]);
		t.push(windowEnd - age[i] * 1000);
	}
	return {
		windowMinutes: json.windowMinutes,
		windowEnd,
		obsTime: parseUtc(json.obsTime),
		coverageStart: parseUtc(json.coverageStart),
		status: typeof json.status === "string" ? json.status : "ready",
		count: t.length,
		lat: Float64Array.from(la),
		lon: Float64Array.from(lo),
		time: Float64Array.from(t),
	};
}

/** Flashes younger than this pulse (s). */
export const LIGHTNING_PULSE_S = 120;
const PULSE_PERIOD_S = 1.4;

const AGE_STOPS: readonly {
	age: number;
	rgb: [number, number, number];
	alpha: number;
}[] = [
	{ age: 0, rgb: [255, 255, 225], alpha: 1 },
	{ age: 120, rgb: [255, 245, 150], alpha: 1 },
	{ age: 600, rgb: [255, 215, 60], alpha: 0.85 },
	{ age: 1800, rgb: [255, 160, 40], alpha: 0.5 },
	{ age: 3600, rgb: [230, 110, 40], alpha: 0.22 },
];

/** Marker colour/opacity of a flash `ageSeconds` old: white-yellow now → yellow 10 min → orange, fading; 0 past the window. */
export function lightningAgeStyle(
	ageSeconds: number,
	windowSeconds: number,
): { rgb: [number, number, number]; alpha: number } {
	const age = Math.max(0, ageSeconds);
	if (age > windowSeconds)
		return { rgb: AGE_STOPS[AGE_STOPS.length - 1].rgb, alpha: 0 };
	// The ramp is defined for a 60-min window and stretched to the served one.
	const a = (age * 3600) / windowSeconds;
	for (let i = 1; i < AGE_STOPS.length; i++) {
		const p = AGE_STOPS[i - 1];
		const q = AGE_STOPS[i];
		if (a <= q.age) {
			const k = (a - p.age) / (q.age - p.age);
			const mix = (x: number, y: number) => Math.round(x + (y - x) * k);
			return {
				rgb: [
					mix(p.rgb[0], q.rgb[0]),
					mix(p.rgb[1], q.rgb[1]),
					mix(p.rgb[2], q.rgb[2]),
				],
				alpha: p.alpha + (q.alpha - p.alpha) * k,
			};
		}
	}
	const last = AGE_STOPS[AGE_STOPS.length - 1];
	return { rgb: last.rgb, alpha: last.alpha };
}

/** Pulse ring strength 0..1 of a recent flash at wall-clock `nowMs` (real age, not a fake animation). */
export function pulsePhase(ageSeconds: number, nowMs: number): number {
	if (!(ageSeconds < LIGHTNING_PULSE_S)) return 0;
	const strength = 1 - Math.max(0, ageSeconds) / LIGHTNING_PULSE_S;
	const cycle = ((nowMs / 1000) % PULSE_PERIOD_S) / PULSE_PERIOD_S;
	return strength * (0.5 + 0.5 * Math.cos(cycle * 2 * Math.PI));
}

export interface FlashCell {
	/** Centroid, mercator metres. */
	x: number;
	y: number;
	count: number;
	latest: number;
}

/** Grid binning in mercator metres, largest cells first. */
export function clusterFlashes(
	d: LightningData,
	cellMeters: number,
): FlashCell[] {
	const cells = new Map<
		string,
		{ sx: number; sy: number; count: number; latest: number }
	>();
	for (let i = 0; i < d.count; i++) {
		const m = lonLatToMercator(d.lon[i], d.lat[i]);
		const key = `${Math.floor(m.x / cellMeters)},${Math.floor(m.y / cellMeters)}`;
		const c = cells.get(key);
		if (c) {
			c.sx += m.x;
			c.sy += m.y;
			c.count++;
			c.latest = Math.max(c.latest, d.time[i]);
		} else cells.set(key, { sx: m.x, sy: m.y, count: 1, latest: d.time[i] });
	}
	return [...cells.values()]
		.map((c) => ({
			x: c.sx / c.count,
			y: c.sy / c.count,
			count: c.count,
			latest: c.latest,
		}))
		.sort((a, b) => b.count - a.count);
}

/** Views wider than this (ground metres) show clusters; closer views every flash. */
export const CLUSTER_ABOVE_M = 300_000;

export function clusterMode(regionMeters: number): {
	mode: "clusters" | "flashes";
	cellMeters: number;
} {
	return regionMeters > CLUSTER_ABOVE_M
		? { mode: "clusters", cellMeters: regionMeters / 24 }
		: { mode: "flashes", cellMeters: 0 };
}

function haversineKm(
	lon1: number,
	lat1: number,
	lon2: number,
	lat2: number,
): number {
	const r = (d: number) => (d * Math.PI) / 180;
	const a =
		Math.sin(r(lat2 - lat1) / 2) ** 2 +
		Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
	return (2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)))) / 1000;
}

/** Readout radius around a queried point (km). */
export const LIGHTNING_READOUT_KM = 20;

export function lightningSummary(
	d: LightningData,
	lon: number,
	lat: number,
	radiusKm: number,
): { count: number; latest: number | null } {
	let count = 0;
	let latest: number | null = null;
	for (let i = 0; i < d.count; i++) {
		if (haversineKm(lon, lat, d.lon[i], d.lat[i]) > radiusKm) continue;
		count++;
		if (latest === null || d.time[i] > latest) latest = d.time[i];
	}
	return { count, latest };
}

/** "2 destellos a menos de 20 km en los últimos 60 min · último 10:31 UTC (hace 2 min)". */
export function formatLightningReadout(
	s: { count: number; latest: number | null },
	radiusKm: number,
	windowMinutes: number,
	nowMs: number,
): string {
	const where = `a menos de ${radiusKm} km en los últimos ${Math.round(windowMinutes)} min`;
	if (s.count === 0 || s.latest === null) return `ningún destello ${where}`;
	const what = `${s.count.toLocaleString("es")} destello${s.count === 1 ? "" : "s"}`;
	return `${what} ${where} · último ${formatUtcClock(s.latest)} (hace ${formatAge((nowMs - s.latest) / 1000)})`;
}
