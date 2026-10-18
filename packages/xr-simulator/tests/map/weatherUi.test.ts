import { afterEach, describe, expect, it, vi } from "vitest";
import { tileMaterialOptions } from "../../src/map/lod/terrainMaterial";
import { BACKEND_DOWN_NOTICE } from "../../src/map/weather/catalog";
import {
	type WeatherApi,
	WeatherController,
} from "../../src/map/weather/WeatherController";

const BOUNDS = {
	minX: -9295177.481238343,
	minY: -2332357.8126193313,
	maxX: -7402746.137752692,
	maxY: 244963.0806270098,
};
const TIMES = [
	{ id: "20261018T0600Z", validTime: "2026-10-18T06:00:00Z", forecastHour: 0 },
	{ id: "20261018T0900Z", validTime: "2026-10-18T09:00:00Z", forecastHour: 3 },
];
const gfs = (id: string, units: string) => ({
	id,
	kind: "forecast",
	valueKind: "scalar",
	source: "NOAA GFS 0.25°",
	attribution: "NOAA/NCEP Global Forecast System",
	units,
	status: "ready",
	issueTime: "2026-10-18T06:00:00Z",
	ageSeconds: 100,
	times: TIMES,
	grid: { width: 2, height: 2, mercatorBounds: BOUNDS },
});
const CATALOG = {
	generatedAt: "2026-10-18T10:00:00Z",
	layers: [
		gfs("gfs-t2m", "°C"),
		gfs("gfs-wind10m", "m/s"),
		gfs("gfs-precip", "mm/h"),
		gfs("gfs-cape", "J/kg"),
		{
			id: "glm-lightning",
			kind: "observed",
			valueKind: "events",
			source: "NOAA GOES-19 GLM",
			attribution: "NOAA GOES-19 Geostationary Lightning Mapper (GLM)",
			status: "ready",
			obsTime: "2026-10-18T09:58:00Z",
			ageSeconds: 120,
			windowMinutes: 60,
			times: [],
		},
		{
			id: "goes-clouds",
			kind: "observed",
			valueKind: "image",
			source: "NOAA GOES-19 ABI",
			attribution: "NOAA GOES-19 ABI L2",
			status: "ready",
			obsTime: "2026-10-18T09:40:00Z",
			fallback: true,
			ageSeconds: 1200,
			imagePath: "/api/clouds/image",
			times: [],
		},
	],
};

function api(over: Partial<WeatherApi> = {}): WeatherApi {
	return {
		catalog: vi.fn(async () => CATALOG),
		meta: vi.fn(async () => {
			throw new Error("unused");
		}),
		grid: vi.fn(async () => {
			throw new Error("unused");
		}),
		point: vi.fn(async () => {
			throw new Error("unused");
		}),
		lightning: vi.fn(async () => {
			throw new Error("unused");
		}),
		clouds: vi.fn(async () => {
			throw new Error("unused");
		}),
		cloudImage: vi.fn(async () => {
			throw new Error("unused");
		}),
		...over,
	};
}

afterEach(() => vi.useRealTimers());

describe("weather backend down", () => {
	it("disables every layer with a Spanish notice and retries the catalog once a minute, no storm", async () => {
		vi.useFakeTimers();
		const a = api({
			catalog: vi.fn(async () => {
				throw new Error("HTTP 502");
			}),
		});
		const c = new WeatherController(a, {
			now: () => Date.UTC(2026, 9, 18, 10),
		});
		await c.start();
		const s = c.snapshot();
		expect(s.backend).toBe("down");
		expect(s.notice).toBe(BACKEND_DOWN_NOTICE);
		expect(s.notice).toMatch(/^Capas meteorológicas no disponibles/);
		expect(s.layers.every((l) => l.disabled && !l.enabled)).toBe(true);
		c.setEnabled("temperature", true);
		expect(
			c.snapshot().layers.find((l) => l.id === "temperature")!.enabled,
		).toBe(false);
		expect(a.catalog).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(59_000);
		expect(a.catalog).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(a.catalog).toHaveBeenCalledTimes(2);
		c.dispose();
	});

	it("with the catalog the layers are offered, the time nearest to now is selected and attribution shows only for enabled layers", async () => {
		const c = new WeatherController(api(), {
			now: () => Date.UTC(2026, 9, 18, 8, 50),
		});
		await c.start();
		const s = c.snapshot();
		expect(s.backend).toBe("ready");
		expect(s.notice).toBeNull();
		expect(
			s.layers.map((l) => [l.id, l.title, l.kindLabel, l.disabled]),
		).toEqual([
			["clouds", "Nubes", "observado", false],
			["rain", "Lluvia", "pronóstico", false],
			["lightning", "Rayos", "observado", false],
			["cape", "Potencial convectivo", "pronóstico", false],
			["wind", "Viento", "pronóstico", false],
			["temperature", "Temperatura", "pronóstico", false],
		]);
		expect(s.timeIndex).toBe(1);
		expect(s.attribution).toBeNull();
		c.setEnabled("clouds", true);
		const on = c.snapshot();
		expect(on.attribution).toBe("Nubes: NOAA GOES-19 ABI L2");
		const p = on.provenance.find((e) => e.id === "clouds")!;
		expect(p).toMatchObject({
			kindLabel: "observado",
			source: "NOAA GOES-19 ABI",
			attribution: "NOAA GOES-19 ABI L2",
		});
		expect(p.notice).toMatch(/muestra de respaldo/);
		c.dispose();
	});
});

describe("terrain material variants", () => {
	it("overview and context compile exactly as before without weather", () => {
		const base = ["uHeight", "uParentHeight", "uImagery", "uParentImagery"];
		expect(tileMaterialOptions(false, false)).toMatchObject({
			defines: [],
			samplers: base,
		});
		expect(tileMaterialOptions(true, false)).toMatchObject({
			defines: ["CONTEXT"],
			samplers: base,
		});
		expect(tileMaterialOptions(false, false).uniforms).not.toContain(
			"uTileWorld",
		);
	});

	it("the WEATHER variant adds its samplers and uniforms", () => {
		const o = tileMaterialOptions(true, true);
		expect(o.defines).toEqual(["CONTEXT", "WEATHER"]);
		expect(o.samplers).toEqual([
			"uHeight",
			"uParentHeight",
			"uImagery",
			"uParentImagery",
			"uWx",
			"uWxPrev",
			"uWxCape",
			"uWxOverlay",
			"uWxClouds",
		]);
		expect(o.uniforms).toEqual(
			expect.arrayContaining([
				"uTileWorld",
				"uWxOn",
				"uWxBounds",
				"uWxMix",
				"uWxOverlayRect",
				"uWxCloudRect",
			]),
		);
	});
});
