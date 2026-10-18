import { describe, expect, it } from "vitest";
import { lonLatToWorld } from "../../src/map/tileMath";
import { capeLevel, formatCape } from "../../src/map/weather/cape";
import { cloudUpdate, parseCloudMeta } from "../../src/map/weather/clouds";
import { colorCape, colorScalars } from "../../src/map/weather/composite";
import {
	clusterFlashes,
	clusterMode,
	formatLightningReadout,
	lightningAgeStyle,
	lightningSummary,
	parseLightning,
	pulsePhase,
} from "../../src/map/weather/lightning";
import {
	cssGradient,
	legendTicks,
	paletteColor,
	TEMPERATURE_PALETTE,
	WIND_PALETTE,
} from "../../src/map/weather/palette";
import { pointLines } from "../../src/map/weather/pointQuery";
import {
	formatRain,
	RAIN_SCALES,
	rainColor,
	rainIndex,
	rainLegendStops,
} from "../../src/map/weather/rain";
import {
	forecastLabel,
	formatAge,
	formatUtc,
	nearestIndex,
	parseTimes,
	stepIndex,
} from "../../src/map/weather/timeline";
import {
	advectWorld,
	animationSpeedFactor,
	compassLabel,
	formatWind,
	ParticleField,
	windDirectionFrom,
} from "../../src/map/weather/wind";

const BOUNDS = {
	minX: -9295177.481238343,
	minY: -2332357.8126193313,
	maxX: -7402746.137752692,
	maxY: 244963.0806270098,
};

describe("colour ramps and legends", () => {
	it("temperature: blue at −10 °C, red at 40 °C, linear between stops, clamped outside", () => {
		expect(paletteColor(TEMPERATURE_PALETTE, -30)).toEqual([49, 54, 149, 255]);
		expect(paletteColor(TEMPERATURE_PALETTE, 40)).toEqual([165, 0, 38, 255]);
		expect(paletteColor(TEMPERATURE_PALETTE, 17)).toEqual([
			210, 220.5, 122.5, 255,
		]);
		expect(cssGradient(TEMPERATURE_PALETTE)).toMatch(
			/^linear-gradient\(to right, rgb\(49 54 149\) 0%, .* rgb\(165 0 38\) 100%\)$/,
		);
		expect(legendTicks(-10, 40, 10)).toEqual([-10, 0, 10, 20, 30, 40]);
		expect(paletteColor(WIND_PALETTE, 0)).toEqual([150, 170, 240, 255]);
	});

	it("rain: threshold-index space, transparent up to 0.1 mm/h, magenta above 50", () => {
		expect(rainIndex(0, RAIN_SCALES.rate.thresholds)).toBe(0);
		expect(rainIndex(0.05, RAIN_SCALES.rate.thresholds)).toBeCloseTo(0.5);
		expect(rainIndex(2.5, RAIN_SCALES.rate.thresholds)).toBe(3);
		expect(rainIndex(80, RAIN_SCALES.rate.thresholds)).toBe(7);
		expect(rainColor(0.05, "rate")[3]).toBe(0);
		expect(rainColor(80, "rate")).toEqual([180, 30, 170, 250]);
		expect(rainColor(Number.NaN, "rate")).toEqual([0, 0, 0, 0]);
		expect(rainLegendStops("accum").map((s) => s.label)).toEqual([
			"0,5",
			"2",
			"5",
			"10",
			"25",
			"50",
			"100",
		]);
	});

	it("CAPE: transparent below 250 J/kg, then marginal / moderate / high", () => {
		expect([0, 249, 250, 999, 1000, 2500, 4000].map(capeLevel)).toEqual([
			0, 0, 1, 1, 2, 3, 3,
		]);
		expect(formatCape(1470.4)).toBe(
			"1470 J/kg · potencial moderado (pronóstico)",
		);
		expect(formatCape(100)).toBe(
			"100 J/kg · sin potencial significativo (pronóstico)",
		);
		expect(formatCape(null)).toBe("sin datos aquí");
	});

	it("composites temperature under rain as premultiplied RGBA, off layers and no data transparent", () => {
		const t = Float32Array.from([40, Number.NaN]);
		const r = {
			rate: Float32Array.from([0, 80]),
			accum: Float32Array.from([0, 0]),
		};
		const tOnly = colorScalars(2, { temperature: { values: t, opacity: 1 } });
		expect(Array.from(tOnly)).toEqual([165, 0, 38, 255, 0, 0, 0, 0]);
		const both = colorScalars(2, {
			temperature: { values: t, opacity: 0.5 },
			rain: { bands: r, mode: "rate", opacity: 1 },
		});
		// Pixel 0: no rain over half-opaque temperature; pixel 1: rain only (temperature has no data).
		expect(Array.from(both.slice(0, 4))).toEqual([83, 0, 19, 128]);
		expect(both[7]).toBe(250);
		expect(both[4]).toBe(Math.round((180 * 250) / 255));
		const cape = colorCape(Float32Array.from([100, 300, 3000]));
		expect(Array.from(cape)).toEqual([
			190, 160, 255, 0, 190, 160, 255, 85, 235, 50, 215, 255,
		]);
	});
});

describe("forecast time axis", () => {
	const json = [
		{
			id: "20261018T0600Z",
			validTime: "2026-10-18T06:00:00Z",
			forecastHour: 0,
		},
		{
			id: "20261018T0900Z",
			validTime: "2026-10-18T09:00:00Z",
			forecastHour: 3,
		},
		{
			id: "20261018T1200Z",
			validTime: "2026-10-18T12:00:00Z",
			forecastHour: 6,
		},
	];

	it("parses the shared times and selects the one nearest to now", () => {
		const times = parseTimes(json);
		expect(times.map((t) => t.forecastHour)).toEqual([0, 3, 6]);
		expect(nearestIndex(times, Date.UTC(2026, 9, 18, 10, 20))).toBe(1);
		expect(nearestIndex(times, Date.UTC(2026, 9, 20))).toBe(2);
		expect(nearestIndex([], 0)).toBe(-1);
		expect(parseTimes([{ id: "x" }, ...json]).length).toBe(3);
	});

	it("steps with wrap-around (play) and labels the lead time in Spanish", () => {
		expect(stepIndex(2, 3, 1)).toBe(0);
		expect(stepIndex(0, 3, -1)).toBe(2);
		expect(stepIndex(-1, 0, 1)).toBe(-1);
		expect(formatUtc(Date.UTC(2026, 9, 18, 9))).toBe("2026-10-18 09:00 UTC");
		expect(
			forecastLabel(Date.UTC(2026, 9, 18, 12), Date.UTC(2026, 9, 18, 6)),
		).toBe("Pronóstico +6 h del ciclo 2026-10-18 06:00 UTC");
		expect(
			forecastLabel(Date.UTC(2026, 9, 18, 6), Date.UTC(2026, 9, 18, 6)),
		).toBe("Análisis (+0 h) del ciclo 2026-10-18 06:00 UTC");
		expect(formatAge(42)).toBe("42 s");
		expect(formatAge(1312)).toBe("21 min");
		expect(formatAge(16333)).toBe("4 h 32 min");
	});
});

describe("observed lightning", () => {
	const end = Date.UTC(2026, 9, 18, 10, 32);
	const json = {
		windowMinutes: 60,
		windowEnd: "2026-10-18T10:32:00Z",
		obsTime: "2026-10-18T10:30:40Z",
		coverageStart: "2026-10-18T09:32:00Z",
		status: "ready",
		bounds: { west: -83.5, south: -20.5, east: -66.5, north: 2.2 },
		flashes: {
			lat: [-12.0, -12.05, 1.0, "x"],
			lon: [-77.0, -77.05, -70.0, -70],
			age: [3000, 60, 30, 10],
			energyFj: [1, 2, 3, 4],
		},
	};

	it("parses the columnar flashes (time = windowEnd − age) and drops malformed ones", () => {
		const d = parseLightning(json)!;
		expect(d.count).toBe(3);
		expect(d.time[1]).toBe(end - 60_000);
		expect(parseLightning({ ...json, windowEnd: "never" })).toBeNull();
	});

	it("fades by age: white-yellow now, orange and faint at the window end, gone after it", () => {
		expect(lightningAgeStyle(0, 3600)).toEqual({
			rgb: [255, 255, 225],
			alpha: 1,
		});
		const old = lightningAgeStyle(3600, 3600);
		expect(old.rgb).toEqual([230, 110, 40]);
		expect(old.alpha).toBeCloseTo(0.22);
		expect(lightningAgeStyle(1200, 3600).alpha).toBeGreaterThan(
			lightningAgeStyle(2400, 3600).alpha,
		);
		expect(lightningAgeStyle(3601, 3600).alpha).toBe(0);
		expect(pulsePhase(200, 0)).toBe(0);
		expect(pulsePhase(0, 0)).toBe(1);
	});

	it("clusters wide views, counts flashes near a point and writes the readout in Spanish", () => {
		const d = parseLightning(json)!;
		expect(clusterMode(500_000)).toEqual({
			mode: "clusters",
			cellMeters: 500_000 / 24,
		});
		expect(clusterMode(100_000).mode).toBe("flashes");
		const cells = clusterFlashes(d, 200_000);
		expect(cells[0].count).toBe(2);
		expect(cells[0].latest).toBe(end - 60_000);
		const s = lightningSummary(d, -77.03, -12.03, 20);
		expect(s).toEqual({ count: 2, latest: end - 60_000 });
		expect(formatLightningReadout(s, 20, 60, end + 60_000)).toBe(
			"2 destellos a menos de 20 km en los últimos 60 min · último 10:31 UTC (hace 2 min)",
		);
		expect(
			formatLightningReadout({ count: 0, latest: null }, 20, 60, end),
		).toBe("ningún destello a menos de 20 km en los últimos 60 min");
	});
});

describe("wind", () => {
	it("direction is where the wind comes from, with Spanish compass points", () => {
		expect(windDirectionFrom(0, -5)).toBeCloseTo(0);
		expect(windDirectionFrom(5, 5)).toBeCloseTo(225);
		expect(compassLabel(225)).toBe("SO");
		expect(compassLabel(292.5)).toBe("ONO");
		expect(formatWind(0.79, 1.767)).toBe("7 km/h del SSO (204°)");
		expect(formatWind(0.1, 0.1)).toBe("calma (< 1 km/h)");
	});

	it("advects a particle in true metres (Mercator stretch 1 / cos lat) in world units", () => {
		const w = lonLatToWorld(-77, -12);
		const C = 2 * Math.PI * 6378137;
		const east = advectWorld(w.x, w.y, 10, 0, 100);
		expect((east.x - w.x) * C * Math.cos((-12 * Math.PI) / 180)).toBeCloseTo(
			1000,
			0,
		);
		expect(east.y).toBe(w.y);
		const north = advectWorld(w.x, w.y, 0, 10, 100);
		expect(north.y).toBeLessThan(w.y);
		expect(animationSpeedFactor(250_000)).toBe(1000);
	});

	it("a particle step moves particles along the field and respawns those that leave the region or reach no data", () => {
		const region = { x0: 0.28, y0: 0.53, side: 0.001 };
		let k = 0;
		const field = new ParticleField(3, () => ((k++ % 7) + 0.5) / 7);
		field.respawnAll(region);
		const before = { x: field.x[0], y: field.y[0] };
		const moved = field.step(region, 1, () => ({ u: 10, v: 0 }), 1);
		expect(moved).toBe(3);
		expect(field.x[0]).toBeGreaterThan(before.x);
		expect(field.px[0]).toBe(before.x);
		expect(field.speed[0]).toBe(10);
		field.step(region, 1, () => null, 1);
		for (let i = 0; i < 3; i++) {
			expect(field.x[i]).toBeGreaterThanOrEqual(region.x0);
			expect(field.x[i]).toBeLessThanOrEqual(region.x0 + region.side);
			expect(field.age[i]).toBe(0);
		}
	});
});

describe("cloud polling", () => {
	const meta = {
		id: "goes-clouds",
		scanStart: "2026-10-18T10:20:21.0Z",
		width: 2048,
		height: 2789,
		mercatorBounds: BOUNDS,
		fallback: false,
		imagePath: "/api/clouds/image?scan=20262911020210",
		source: "NOAA GOES-19 ABI",
		attribution: "NOAA GOES-19",
		ageSeconds: 968,
		status: "ready",
	};

	it("parses /clouds and swaps the texture only when scanStart changes", () => {
		const m = parseCloudMeta(meta)!;
		expect(m).toMatchObject({
			scanStart: "2026-10-18T10:20:21.0Z",
			fallback: false,
			imagePath: "/api/clouds/image?scan=20262911020210",
		});
		expect(cloudUpdate(null, m)).toBe("swap");
		expect(cloudUpdate("2026-10-18T10:20:21.0Z", m)).toBe("keep");
		expect(cloudUpdate("2026-10-18T10:10:21.0Z", m)).toBe("swap");
		expect(
			parseCloudMeta({ ...meta, imagePath: "https://evil.example/x.png" }),
		).toBeNull();
		expect(parseCloudMeta({ ...meta, mercatorBounds: null })).toBeNull();
	});
});

describe("point query formatting", () => {
	it("lists every enabled layer at the point, with forecast/observed wording and missing data", () => {
		const lines = pointLines({
			temperature: 19.554,
			wind: { u: 0.79, v: 1.767 },
			rain: {
				value: { rate: 2.34, accum: 14.2 },
				mode: "rate",
				issueTime: Date.UTC(2026, 9, 18, 6),
			},
			cape: null,
			lightning: {
				summary: { count: 0, latest: null },
				radiusKm: 20,
				windowMinutes: 60,
			},
			now: Date.UTC(2026, 9, 18, 10),
		});
		expect(lines.map((l) => `${l.label}: ${l.text}`)).toEqual([
			"Temperatura: 19,6 °C (pronóstico)",
			"Viento: 7 km/h del SSO (204°) (pronóstico)",
			"Lluvia: 2,3 mm/h (pronóstico)",
			"Potencial convectivo: sin datos aquí",
			"Rayos: ningún destello a menos de 20 km en los últimos 60 min",
		]);
		expect(
			pointLines({
				rain: {
					value: { rate: 0, accum: 14.2 },
					mode: "accum",
					issueTime: Date.UTC(2026, 9, 18, 6),
				},
				now: 0,
			})[0].text,
		).toBe("14 mm acumulados desde 2026-10-18 06:00 UTC (pronóstico)");
		expect(pointLines({ temperature: "loading", now: 0 })[0].text).toBe(
			"cargando…",
		);
		expect(pointLines({ now: 0 })).toEqual([]);
		expect(formatRain({ rate: 0.05, accum: 0 }, "rate", 0)).toBe(
			"sin lluvia (< 0,1 mm/h, pronóstico)",
		);
	});
});
