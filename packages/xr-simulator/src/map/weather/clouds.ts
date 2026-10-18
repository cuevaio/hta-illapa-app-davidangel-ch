import { type MercatorBounds, parseMercatorBounds } from "./grid";

/**
 * Observed clouds (GOES-19 ABI, GET /api/clouds): one grey + alpha PNG per scan, polled every
 * 10 min; the texture is swapped only when `scanStart` changes. Pure.
 */
export interface CloudMeta {
	scanStart: string;
	width: number;
	height: number;
	bounds: MercatorBounds;
	/** The committed sample, not a live scan. */
	fallback: boolean;
	/** Relative to the API base (prefix with /weather-api). */
	imagePath: string;
	source: string;
	attribution: string;
	ageSeconds: number | null;
	status: string;
}

export const CLOUD_POLL_MS = 10 * 60_000;

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null;
/** Only our own image route (never an absolute or foreign URL from the response). */
const IMAGE_PATH = /^\/api\/clouds\/image(\?scan=\w+)?$/;

export function parseCloudMeta(json: unknown): CloudMeta | null {
	if (!isRecord(json)) return null;
	const bounds = parseMercatorBounds(json.mercatorBounds);
	const { scanStart, width, height, imagePath } = json;
	if (
		!bounds ||
		typeof scanStart !== "string" ||
		Number.isNaN(Date.parse(scanStart))
	)
		return null;
	if (
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		(width as number) <= 0 ||
		(height as number) <= 0
	)
		return null;
	if (typeof imagePath !== "string" || !IMAGE_PATH.test(imagePath)) return null;
	return {
		scanStart,
		width: width as number,
		height: height as number,
		bounds,
		fallback: json.fallback === true,
		imagePath,
		source: String(json.source ?? ""),
		attribution: String(json.attribution ?? ""),
		ageSeconds: typeof json.ageSeconds === "number" ? json.ageSeconds : null,
		status: String(json.status ?? "ready"),
	};
}

/** New scan → swap the texture; same scan → keep it (no download). */
export function cloudUpdate(
	shownScanStart: string | null,
	meta: CloudMeta,
): "swap" | "keep" {
	return shownScanStart === meta.scanStart ? "keep" : "swap";
}
