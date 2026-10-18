import { formatCape } from "./cape";
import { formatLightningReadout } from "./lightning";
import { esNumber } from "./palette";
import { formatRain, type RainMode, type RainValue } from "./rain";
import { formatWind } from "./wind";

/**
 * Point query readout (web click and the VR card): one line per enabled layer, in panel order.
 * `undefined` = layer off, `null` = no data at the point, 'loading' = its grid is on its way. Pure.
 */
export interface PointInputs {
	temperature?: number | null | "loading";
	wind?: { u: number; v: number } | null | "loading";
	rain?:
		| { value: RainValue; mode: RainMode; issueTime: number }
		| null
		| "loading";
	cape?: number | null | "loading";
	lightning?:
		| {
				summary: { count: number; latest: number | null };
				radiusKm: number;
				windowMinutes: number;
		  }
		| null
		| "loading";
	now: number;
}

export interface PointLine {
	id: "temperature" | "wind" | "rain" | "cape" | "lightning";
	label: string;
	text: string;
}

const NO_DATA = "sin datos aquí";
const LOADING = "cargando…";

export function pointLines(p: PointInputs): PointLine[] {
	const out: PointLine[] = [];
	const add = <T>(
		id: PointLine["id"],
		label: string,
		v: T | null | "loading" | undefined,
		f: (v: T) => string,
	) => {
		if (v === undefined) return;
		out.push({
			id,
			label,
			text: v === "loading" ? LOADING : v === null ? NO_DATA : f(v),
		});
	};
	add(
		"temperature",
		"Temperatura",
		p.temperature,
		(t) => `${esNumber(t, 1)} °C (pronóstico)`,
	);
	add("wind", "Viento", p.wind, (w) => `${formatWind(w.u, w.v)} (pronóstico)`);
	add("rain", "Lluvia", p.rain, (r) =>
		formatRain(r.value, r.mode, r.issueTime),
	);
	add("cape", "Potencial convectivo", p.cape, (c) => formatCape(c));
	add("lightning", "Rayos", p.lightning, (l) =>
		formatLightningReadout(l.summary, l.radiusKm, l.windowMinutes, p.now),
	);
	return out;
}
