import { describe, expect, it } from "vitest";
import {
	attributionFrom,
	DEFAULT_ATTRIBUTION,
	startScreen,
	TILES_DOWN_NOTICE,
	TilesClient,
	TilesUnavailableError,
	tilesBaseUrl,
} from "../../src/map/tilesClient";

const png = () =>
	new Response(new Uint8Array([1, 2, 3]), {
		status: 200,
		headers: {
			"X-Tile-Min": "-10",
			"X-Tile-Max": "6700",
			"X-Tile-Source": "terrain-tiles",
			"X-Tile-Overzoom": "0",
			"X-Cache": "HIT",
		},
	});
const decode = async () => ({
	width: 1,
	height: 1,
	rgba: new Uint8Array([128, 10, 0, 255]),
});

describe("tiles API client", () => {
	it("defaults to /tiles-api and honours VITE_TILES_URL (without trailing slash)", () => {
		expect(tilesBaseUrl({})).toBe("/tiles-api");
		expect(tilesBaseUrl({ VITE_TILES_URL: "http://x:9/" })).toBe("http://x:9");
	});

	it("requests /tiles/terreno/v1/z/x/y and decodes heights + metadata headers", async () => {
		const urls: string[] = [];
		const client = new TilesClient(
			"/tiles-api",
			async (u) => {
				urls.push(String(u));
				return png();
			},
			decode,
		);
		const t = await client.tile({ z: 6, x: 18, y: 33 });
		expect(urls).toEqual(["/tiles-api/tiles/terreno/v1/6/18/33"]);
		expect(t!.heights[0]).toBe(10);
		expect(t!.meta).toMatchObject({
			min: -10,
			max: 6700,
			source: "terrain-tiles",
			overzoom: false,
			cache: "HIT",
		});
	});

	it("maps a network failure to TilesUnavailableError", async () => {
		const client = new TilesClient(
			"/tiles-api",
			async () => {
				throw new TypeError("Failed to fetch");
			},
			decode,
		);
		await expect(client.tile({ z: 6, x: 18, y: 33 })).rejects.toBeInstanceOf(
			TilesUnavailableError,
		);
		await expect(client.health()).rejects.toBeInstanceOf(TilesUnavailableError);
	});

	it("maps a proxy error (502/504) on /salud to TilesUnavailableError", async () => {
		const client = new TilesClient(
			"/tiles-api",
			async () => new Response("bad gateway", { status: 502 }),
			decode,
		);
		await expect(client.health()).rejects.toBeInstanceOf(TilesUnavailableError);
	});

	it("reads the terrain attribution from /capas, with a static fallback", () => {
		expect(attributionFrom(null)).toBeNull();
		// Shapes outside the shared Capas schema no longer match (S4): the static fallback applies.
		expect(
			attributionFrom({
				capas: [{ capa: "terreno", atribuciones: ["A", "B"] }],
			}),
		).toBeNull();
		expect(
			attributionFrom({
				capas: [
					{
						id: "terreno",
						version_actual: "v1",
						versiones: [{ version: "v1", fuente: { atribucion: " " } }],
					},
				],
			}),
		).toBeNull();
		// Shape served by services/tiles: attribution nested in versiones[].fuente.
		const real = {
			capas: [
				{
					id: "terreno",
					version_actual: "v1",
					versiones: [
						{
							version: "v1",
							fuente: {
								id: "terrain-tiles",
								nombre: "Terrain Tiles on AWS (Terrarium)",
								atribucion: "USGS SRTM/GMTED.",
							},
						},
					],
				},
			],
		};
		expect(attributionFrom(real)).toBe(
			"Terreno: Terrain Tiles on AWS (Terrarium). USGS SRTM/GMTED.",
		);
		// The current version wins over the first one.
		const two = {
			capas: [
				{
					id: "otra",
					version_actual: "v1",
					versiones: [
						{ version: "v1", fuente: { nombre: "N", atribucion: "otra" } },
					],
				},
				{
					id: "terreno",
					version_actual: "v2",
					versiones: [
						{ version: "v1", fuente: { nombre: "Vieja", atribucion: "A1" } },
						{ version: "v2", fuente: { nombre: "Nueva", atribucion: "A2" } },
					],
				},
			],
		};
		expect(attributionFrom(two)).toBe("Terreno: Nueva. A2");
		expect(DEFAULT_ATTRIBUTION).toBe(
			"Terreno: Terrain Tiles on AWS (Mapzen/Tilezen y proveedores; SRTM, GMTED)",
		);
	});
});

describe("GET /capas", () => {
	it("returns the typed body, or null when it is not shaped as Capas or the service fails", async () => {
		const body = {
			bbox: { oeste: -81.5, sur: -18.5, este: -68.5, norte: 0.2 },
			cabeceras_tile: [],
			capas: [],
		};
		const ok = new TilesClient("/t", async () => Response.json(body), decode);
		expect(await ok.layers()).toEqual(body);
		expect(
			await new TilesClient(
				"/t",
				async () => Response.json({ otra: 1 }),
				decode,
			).layers(),
		).toBeNull();
		expect(
			await new TilesClient(
				"/t",
				async () => {
					throw new TypeError("x");
				},
				decode,
			).layers(),
		).toBeNull();
	});
});

describe("start screen decision", () => {
	it("shows the Peru overview when the map loaded", () => {
		expect(startScreen({ ok: true })).toEqual({
			screen: "overview",
			notice: null,
		});
	});

	it("falls back to the synthetic simulator, as before, with the Spanish notice when tiles are down", () => {
		expect(
			startScreen({ ok: false, error: new TilesUnavailableError("x") }),
		).toEqual({ screen: "simulator", notice: TILES_DOWN_NOTICE });
		expect(TILES_DOWN_NOTICE).toBe(
			"No se pudo cargar el mapa del Perú: el servicio de tiles no responde (docker compose up)",
		);
	});

	it("reports other failures with their message and still falls back", () => {
		const d = startScreen({ ok: false, error: new Error("boom") });
		expect(d.screen).toBe("simulator");
		expect(d.notice).toContain("No se pudo cargar el mapa del Perú");
		expect(d.notice).toContain("boom");
	});
});
