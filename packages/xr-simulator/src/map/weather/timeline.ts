/** Forecast time axis shared by the GFS layers (`times[]` of /api/layers), pure. Times are epoch ms (UTC). */

export interface TimeEntry {
	id: string;
	validTime: number;
	forecastHour: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null;

/** Validated `times[]` (malformed entries dropped), ascending by valid time. */
export function parseTimes(json: unknown): TimeEntry[] {
	if (!Array.isArray(json)) return [];
	const out: TimeEntry[] = [];
	for (const e of json) {
		if (
			!isRecord(e) ||
			typeof e.id !== "string" ||
			typeof e.validTime !== "string"
		)
			continue;
		const t = Date.parse(e.validTime);
		if (Number.isNaN(t)) continue;
		out.push({
			id: e.id,
			validTime: t,
			forecastHour: typeof e.forecastHour === "number" ? e.forecastHour : 0,
		});
	}
	return out.sort((a, b) => a.validTime - b.validTime);
}

/** Index of the time nearest to `t` (−1 for an empty axis). */
export function nearestIndex(times: readonly TimeEntry[], t: number): number {
	let best = -1;
	let dist = Number.POSITIVE_INFINITY;
	times.forEach((e, i) => {
		const d = Math.abs(e.validTime - t);
		if (d < dist) {
			best = i;
			dist = d;
		}
	});
	return best;
}

/** Next index (play / step), wrapping around. */
export function stepIndex(index: number, count: number, delta: number): number {
	if (count <= 0) return -1;
	return (((index + delta) % count) + count) % count;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatUtc(ms: number): string {
	const d = new Date(ms);
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function formatUtcClock(ms: number): string {
	const d = new Date(ms);
	return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** "Pronóstico +6 h del ciclo 2026-10-18 06:00 UTC". */
export function forecastLabel(validTime: number, issueTime: number): string {
	const h = Math.round((validTime - issueTime) / 3_600_000);
	const cycle = `del ciclo ${formatUtc(issueTime)}`;
	return h === 0
		? `Análisis (+0 h) ${cycle}`
		: `Pronóstico ${h > 0 ? "+" : ""}${h} h ${cycle}`;
}

/** "42 s", "21 min", "4 h 32 min", "2 d 3 h". */
export function formatAge(seconds: number): string {
	const s = Math.max(0, Math.round(seconds));
	if (s < 60) return `${s} s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m} min`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h} h ${m % 60} min`;
	return `${Math.floor(h / 24)} d ${h % 24} h`;
}
