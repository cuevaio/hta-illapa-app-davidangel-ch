import { KIND_LABEL } from "../../map/weather/catalog";

/**
 * Mayu (docs/DESIGN.md) helpers for the viewer's DOM UI; the look itself is in app.css. Weather
 * kinds use the Status badges: an observation is measured data (success), a forecast is model
 * information (info).
 */
export function weatherBadgeClass(kindLabel: string): string {
	return kindLabel === KIND_LABEL.observed
		? "badge badge-success"
		: "badge badge-info";
}

/** The filled part of a web Slider track, in percent. */
export function rangeFillPercent(
	value: number,
	min: number,
	max: number,
): number {
	if (max <= min) return 0;
	return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

/** Paints the range of a native slider like the web Slider (app.css reads `--fill`). */
export function syncRangeFill(input: HTMLInputElement): void {
	input.style.setProperty(
		"--fill",
		`${rangeFillPercent(Number(input.value), Number(input.min), Number(input.max))}%`,
	);
}
