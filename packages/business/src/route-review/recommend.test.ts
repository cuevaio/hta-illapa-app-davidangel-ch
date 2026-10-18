import { describe, expect, it } from "vitest";

import { recommendRoute, routeRiskLevelForScore } from "./recommend";

const quiet = {
	signals: [],
	windowLevel: "low" as const,
	hasLowerRiskAlternative: false,
};

describe("routeRiskLevelForScore", () => {
	it("maps the engine's very high band to the critical route level", () => {
		expect(routeRiskLevelForScore(10)).toBe("low");
		expect(routeRiskLevelForScore(30)).toBe("moderate");
		expect(routeRiskLevelForScore(60)).toBe("high");
		expect(routeRiskLevelForScore(80)).toBe("critical");
	});
});

describe("recommendRoute", () => {
	it("reroutes around a confirmed interruption before any other rule", () => {
		expect(
			recommendRoute({
				...quiet,
				windowLevel: "critical",
				signals: [
					{ kind: "confirmed", roadStatus: "restringido" },
					{ kind: "confirmed", roadStatus: "interrumpido" },
				],
			}),
		).toEqual({
			action: "reroute",
			rule: "confirmed_interruption",
			suggestedDepartureAt: null,
			expectedDelayS: null,
		});
	});

	it("monitors a confirmed restriction", () => {
		expect(
			recommendRoute({
				...quiet,
				signals: [{ kind: "confirmed", roadStatus: "restringido" }],
			}),
		).toMatchObject({ action: "monitor", rule: "confirmed_restriction" });
	});

	it("reroutes a high forecast when an eligible alternative is lower", () => {
		expect(
			recommendRoute({
				...quiet,
				windowLevel: "high",
				hasLowerRiskAlternative: true,
			}),
		).toMatchObject({ action: "reroute", rule: "forecast_in_window" });
	});

	it("delays a critical forecast when no alternative is lower", () => {
		expect(recommendRoute({ ...quiet, windowLevel: "critical" })).toEqual({
			action: "delay",
			rule: "forecast_in_window",
			suggestedDepartureAt: null,
			expectedDelayS: null,
		});
	});

	it("continues with caution on a forecast below high, even with baseline exposure", () => {
		expect(
			recommendRoute({
				...quiet,
				windowLevel: "moderate",
				signals: [
					{ kind: "baseline", roadStatus: null },
					{ kind: "forecast", roadStatus: null },
				],
			}),
		).toEqual({
			action: "continue",
			rule: "forecast_below_high",
			suggestedDepartureAt: null,
			expectedDelayS: null,
		});
		expect(
			recommendRoute({
				...quiet,
				signals: [{ kind: "forecast", roadStatus: null }],
			}),
		).toMatchObject({ action: "continue", rule: "forecast_below_high" });
	});

	it("keeps a high forecast ahead of the forecast-below-high rule", () => {
		expect(
			recommendRoute({
				...quiet,
				windowLevel: "high",
				signals: [{ kind: "forecast", roadStatus: null }],
			}),
		).toMatchObject({ action: "delay", rule: "forecast_in_window" });
	});

	it("continues with a note on baseline exposure only", () => {
		expect(
			recommendRoute({
				...quiet,
				windowLevel: "moderate",
				signals: [{ kind: "baseline", roadStatus: null }],
			}),
		).toMatchObject({ action: "continue", rule: "baseline_only" });
	});

	it("continues when nothing relevant is on the route", () => {
		expect(
			recommendRoute({
				...quiet,
				signals: [{ kind: "confirmed", roadStatus: "normal" }],
			}),
		).toMatchObject({ action: "continue", rule: "nothing_relevant" });
	});
});
