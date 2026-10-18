import { afterEach, describe, expect, it, vi } from "vitest";
import { TilesClient } from "../../src/map/tilesClient";
import { httpWeatherApi } from "../../src/map/weather/weatherApi";
import { resolveEndpoints } from "../../src/viewer/options";

const decode = async () => ({
	width: 1,
	height: 1,
	rgba: new Uint8Array([128, 10, 0, 255]),
});

describe("viewer endpoints", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("defaults to the standalone dev proxies with same-origin credentials", () => {
		expect(resolveEndpoints({}, {})).toEqual({
			tilesBaseUrl: "/tiles-api",
			weatherBaseUrl: "/weather-api",
			credentials: "same-origin",
		});
	});

	it("keeps honouring VITE_TILES_URL when no tiles base is given", () => {
		expect(
			resolveEndpoints({}, { VITE_TILES_URL: "http://tiles:8080/" })
				.tilesBaseUrl,
		).toBe("http://tiles:8080");
	});

	it("uses the injected bases (without trailing slashes) and credentials over the env", () => {
		const endpoints = resolveEndpoints(
			{
				tilesBaseUrl: "https://api.example.com/tiles-api/",
				weatherBaseUrl: "https://api.example.com/weather-api//",
				credentials: "include",
			},
			{ VITE_TILES_URL: "http://tiles:8080" },
		);
		expect(endpoints).toEqual({
			tilesBaseUrl: "https://api.example.com/tiles-api",
			weatherBaseUrl: "https://api.example.com/weather-api",
			credentials: "include",
		});
	});

	it("sends tile requests with the configured credentials", async () => {
		const requests: {
			url: string;
			credentials: RequestCredentials | undefined;
		}[] = [];
		const client = new TilesClient(
			"https://api.example.com/tiles-api",
			async (url, init) => {
				requests.push({ url, credentials: init?.credentials });
				return new Response(new Uint8Array([1]), { status: 200 });
			},
			decode,
			"include",
		);
		await client.tile({ z: 6, x: 18, y: 33 });
		expect(requests).toEqual([
			{
				url: "https://api.example.com/tiles-api/tiles/terreno/v1/6/18/33",
				credentials: "include",
			},
		]);
	});

	it("sends weather requests to the configured base with the configured credentials", async () => {
		const requests: {
			url: string;
			credentials: RequestCredentials | undefined;
		}[] = [];
		vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
			requests.push({ url, credentials: init?.credentials });
			return Response.json({ layers: [] });
		});
		await httpWeatherApi(
			"https://api.example.com/weather-api",
			"include",
		).catalog();
		expect(requests).toEqual([
			{
				url: "https://api.example.com/weather-api/api/layers",
				credentials: "include",
			},
		]);
	});
});
