import { describe, expect, it, vi } from "vitest";
import type { WeatherSnapshot } from "../../src/map/weather/WeatherController";
import { weatherMenuAction, weatherMenuContent } from "../../src/ui/sections";

const layer = (
	id: WeatherSnapshot["layers"][number]["id"],
	title: string,
	kindLabel: string,
	enabled: boolean,
	extra: Partial<WeatherSnapshot["layers"][number]> = {},
): WeatherSnapshot["layers"][number] => ({
	id,
	title,
	kindLabel,
	group: null,
	enabled,
	disabled: false,
	opacity: 0.8,
	status: "ready",
	statusText: null,
	...extra,
});

const snapshot = (over: Partial<WeatherSnapshot> = {}): WeatherSnapshot => ({
	backend: "ready",
	notice: null,
	layers: [
		layer("clouds", "Nubes", "observado", true, { statusText: "cargando…" }),
		layer("rain", "Lluvia", "pronóstico", true, { opacity: 0.5 }),
		layer("lightning", "Rayos", "observado", false),
		layer("cape", "Potencial convectivo", "pronóstico", false),
		layer("wind", "Viento", "pronóstico", false),
		layer("temperature", "Temperatura", "pronóstico", false),
	],
	times: [
		{ id: "a", validTime: 1_760_767_200_000, forecastHour: 0 },
		{ id: "b", validTime: 1_760_778_000_000, forecastHour: 3 },
	],
	timeIndex: 1,
	playing: false,
	timeLabel: "2026-10-18 09:00 UTC",
	leadLabel: "Pronóstico +3 h",
	rainMode: "rate",
	provenance: [
		{
			id: "clouds",
			title: "Nubes",
			kindLabel: "observado",
			source: "NOAA GOES-19 ABI",
			attribution: "NOAA GOES-19 ABI L2",
			time: "Imagen 2026-10-18 08:50 UTC",
			notice: null,
		},
	],
	attribution: "Nubes: NOAA GOES-19 ABI L2",
	lightning: null,
	...over,
});

describe("weatherMenuContent (VR weather menu, S8)", () => {
	it("offers every layer of the web panel with its badge, opacity and status", () => {
		const menu = weatherMenuContent(snapshot(), []);
		expect(
			menu.layers.map((l) => [l.id, l.text, l.badge, l.active, l.disabled]),
		).toEqual([
			["wx:clouds", "Nubes", "observado", true, false],
			["wx:rain", "Lluvia", "pronóstico", true, false],
			["wx:lightning", "Rayos", "observado", false, false],
			["wx:cape", "Potencial convectivo", "pronóstico", false, false],
			["wx:wind", "Viento", "pronóstico", false, false],
			["wx:temperature", "Temperatura", "pronóstico", false, false],
		]);
		expect(menu.layers.map((l) => l.opacity)).toEqual([
			"80 %",
			"50 %",
			null,
			null,
			null,
			null,
		]);
		expect(menu.status).toEqual(["Nubes: cargando…"]);
	});

	it("shows the forecast timeline (play, step, valid time) only with a forecast layer on, as the web", () => {
		expect(weatherMenuContent(snapshot(), []).time).toEqual({
			label: "Válido 2026-10-18 09:00 UTC · Pronóstico +3 h",
			playing: false,
		});
		const observedOnly = snapshot({
			layers: [layer("clouds", "Nubes", "observado", true)],
		});
		expect(weatherMenuContent(observedOnly, []).time).toBeNull();
	});

	it("offers the precipitation scale while rain is on", () => {
		expect(weatherMenuContent(snapshot(), []).rain).toEqual([
			{ id: "wx:rain:rate", icon: "rain", text: "Tasa (mm/h)", active: true },
			{
				id: "wx:rain:accum",
				icon: "rain",
				text: "Acumulada (mm)",
				active: false,
			},
		]);
		const noRain = snapshot({
			layers: [layer("clouds", "Nubes", "observado", true)],
		});
		expect(weatherMenuContent(noRain, []).rain).toBeNull();
	});

	it("lists the legend, provenance, point values and attribution of the enabled layers", () => {
		const menu = weatherMenuContent(snapshot(), [
			{ id: "rain", label: "Lluvia", text: "1,2 mm/h (pronóstico)" },
		]);
		expect(menu.legends.map((l) => l.title)).toEqual([
			"Nubes (observado) — GOES-19 ABI",
			"Precipitación (pronóstico) — GFS",
		]);
		expect(menu.legends[1].text).toContain("0,1 · 1 · 2,5");
		expect(menu.legends[1].text).toContain(
			"Pronóstico del modelo, no lluvia observada.",
		);
		expect(menu.provenance).toEqual([
			"Nubes (observado) · Imagen 2026-10-18 08:50 UTC · Fuente: NOAA GOES-19 ABI",
		]);
		expect(menu.values).toEqual(["Lluvia: 1,2 mm/h (pronóstico)"]);
		expect(menu.credit).toBe(
			"Datos meteorológicos: Nubes: NOAA GOES-19 ABI L2",
		);
	});

	it("shows the backend notice instead of values when the service is down", () => {
		const menu = weatherMenuContent(
			snapshot({ backend: "down", notice: "Capas no disponibles" }),
			[],
		);
		expect(menu.notice).toBe("Capas no disponibles");
	});
});

describe("weatherMenuAction (VR weather menu buttons, S8)", () => {
	const controls = () => ({
		snapshot: vi.fn(() => snapshot()),
		toggle: vi.fn(),
		step: vi.fn(),
		setPlaying: vi.fn(),
		setOpacity: vi.fn(),
		setRainMode: vi.fn(),
	});

	it("drives the same controller calls as the web panel", () => {
		const weather = controls();
		weatherMenuAction(weather, "wx:wind");
		weatherMenuAction(weather, "wx:prev");
		weatherMenuAction(weather, "wx:next");
		weatherMenuAction(weather, "wx:play");
		weatherMenuAction(weather, "wx:rain:accum");
		weatherMenuAction(weather, "wx:opacity-up:rain");
		weatherMenuAction(weather, "wx:opacity-down:clouds");
		expect(weather.toggle).toHaveBeenCalledWith("wind");
		expect(weather.step.mock.calls).toEqual([[-1], [1]]);
		expect(weather.setPlaying).toHaveBeenCalledWith(true);
		expect(weather.setRainMode).toHaveBeenCalledWith("accum");
		expect(weather.setOpacity.mock.calls).toEqual([
			["rain", 0.6],
			["clouds", 0.7],
		]);
	});
});
