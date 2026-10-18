import { CAPE_CATEGORIES, CAPE_NOTE } from "./cape";
import type { WeatherLayerId } from "./catalog";
import { legendTicks } from "./palette";
import { rainLegendStops } from "./rain";
import type { WeatherSnapshot } from "./WeatherController";

/** Legend titles of the weather layers (web panel and VR menu). */
export const LEGEND_TITLE: Record<WeatherLayerId, string> = {
	clouds: "Nubes (observado) — GOES-19 ABI",
	rain: "Precipitación (pronóstico) — GFS",
	lightning: "Rayos (observado) — GOES-19 GLM",
	cape: "Potencial convectivo (pronóstico) — GFS CAPE, J/kg",
	wind: "Viento a 10 m (pronóstico) — GFS, km/h",
	temperature: "Temperatura a 2 m (pronóstico) — GFS, °C",
};

export const TEMPERATURE_TICKS = legendTicks(-10, 40, 10).map(String);
export const WIND_TICKS = legendTicks(0, 100, 25).map(String);
export const LIGHTNING_TICKS = ["ahora", "10 min", "30 min", "60 min"];
export const WIND_NOTE =
	"Partículas animadas, velocidad acelerada para leer el movimiento.";
export const RAIN_NOTE = "Pronóstico del modelo, no lluvia observada.";
export const CLOUDS_NOTE =
	"Brillo = topes de nube (IR); transparencia = probabilidad de nube. Una imagen cada 10 min.";

/** The legend of one layer as text (VR menu): its scale and its note. */
export function legendText(id: WeatherLayerId, s: WeatherSnapshot): string {
	const join = (parts: (string | null)[]) =>
		parts.filter((part) => part !== null).join("\n");
	if (id === "temperature") return TEMPERATURE_TICKS.join(" · ");
	if (id === "wind") return join([WIND_TICKS.join(" · "), WIND_NOTE]);
	if (id === "rain")
		return join([
			rainLegendStops(s.rainMode)
				.map((stop) => stop.label)
				.join(" · "),
			RAIN_NOTE,
		]);
	if (id === "cape")
		return join([
			CAPE_CATEGORIES.map(
				(category) =>
					`${category.label} ≥ ${category.min.toLocaleString("es")}`,
			).join(" · "),
			CAPE_NOTE,
		]);
	if (id === "lightning")
		return join([
			LIGHTNING_TICKS.join(" · "),
			s.lightning ? `${s.lightning.window} · ${s.lightning.count}` : null,
		]);
	return CLOUDS_NOTE;
}
