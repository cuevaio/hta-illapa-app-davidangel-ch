import { createLogger } from "evlog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { classifyAccidentRoadStatus } from "../lib/jev";
import type { MediaBucket } from "../lib/media-bucket";
import {
	parseRoadKm,
	type RouteImpact,
	sratmaAccidentsSource,
	toSratmaIncident,
} from "./sratma";

vi.mock("../lib/jev", () => ({ classifyAccidentRoadStatus: vi.fn() }));

const CONCESSIONAIRE_DETAIL = {
	id_accidente_transito: 22155,
	cod_accidente_transito: "2026_09_19_21_30_-5.16953333_-80.53707778",
	fecha_registro: "19/09/2026",
	hora_registro: "21:30",
	id_clase_accidente: 14,
	clase_accidente: "Choque por alcance",
	direccion: "Km 245 150",
	latitud: "-5.16953333",
	longitud: "-80.53707778",
	otro_clase_accidente: "",
	iddpto: "20",
	idprov: "2001",
	iddist: "200104",
	cod_acc_transito_externo: "A-2026-09-38-CV",
	detalle_hechos:
		" El operador de grúa pasó por el lugar del evento e informa que los vehículos se retiraron por sus propios medios.",
	departamento: "PIURA",
	provincia: "PIURA",
	distrito: "CASTILLA",
	cod_denuncia_sidpol: "",
	estado: "Inicio-cv",
	nro_fallecido: 0,
	nro_lesionado: 1,
	nro_vehiculos: 2,
	fuente_url: "",
	entidad: "IIRSA NORTE S.A",
	es_concesionario: true,
	es_dsv: false,
};

const POLICE_DETAIL = {
	...CONCESSIONAIRE_DETAIL,
	id_accidente_transito: 22668,
	fecha_registro: "17/10/2026",
	hora_registro: "07:20",
	clase_accidente: "Choque",
	direccion: "AV. NESTOR GAMBETTA 33, CALLAO 07046, PERÚ",
	latitud: "-12.0",
	longitud: "-77.1",
	detalle_hechos: "SI",
	departamento: "CALLAO",
	provincia: "CALLAO",
	distrito: "CALLAO",
	estado: "Inicio-Pnp",
	nro_fallecido: 1,
	nro_lesionado: 0,
	entidad: "OQUENDO",
};

const LISTING_FEATURE = {
	type: "Feature",
	geometry: "\\xa1009facad07bf8e9301",
	properties: { id_accidente: 22155 },
	iddist: "200104",
	es_concesionario: true,
	es_dsv: false,
	es_serenazgo: null,
};

const CONTEXT_ONLY: RouteImpact = {
	severity: "info",
	roadStatus: null,
	classification: null,
};

describe("parseRoadKm", () => {
	it("reads concessionaire and police kilometre posts", () => {
		expect(parseRoadKm("Km 245 150")).toBe("245+150");
		expect(parseRoadKm("018 900")).toBe("18+900");
		expect(parseRoadKm("CARRETERA FERNANDO BELAUNDE TERRY KM 431 500")).toBe(
			"431+500",
		);
	});

	it("ignores street addresses", () => {
		expect(parseRoadKm("AV. NESTOR GAMBETTA 33, CALLAO 07046, PERÚ")).toBe(
			null,
		);
		expect(parseRoadKm("5V5W FPX, LEONCIO PRADO, PUENTE PIEDRA 15122")).toBe(
			null,
		);
		expect(parseRoadKm(null)).toBe(null);
	});
});

describe("toSratmaIncident", () => {
	it("maps a concessionaire report with its narrative and tally", () => {
		const record = toSratmaIncident({
			feature: LISTING_FEATURE,
			detail: CONCESSIONAIRE_DETAIL,
			occurredAt: new Date("2026-09-20T02:30:00Z"),
			routeImpact: CONTEXT_ONLY,
			imageUrl: "https://media.test/sratma/accidents/22155.jpg",
		});
		expect(record).toMatchObject({
			sourceId: "22155",
			category: "road_accident",
			severity: "info",
			title: "Choque por alcance · Km 245 150",
			description:
				"El operador de grúa pasó por el lugar del evento e informa que los vehículos se retiraron por sus propios medios.\n0 fallecidos · 1 lesionado · 2 vehículos · Reporta: IIRSA NORTE S.A",
			imageUrl: "https://media.test/sratma/accidents/22155.jpg",
			status: "Inicio-cv",
			roadStatus: null,
			roadKm: "245+150",
			lat: -5.16953333,
			lng: -80.53707778,
			geometry: { type: "Point", coordinates: [-80.53707778, -5.16953333] },
			region: "PIURA",
			provincia: "PIURA",
			distrito: "CASTILLA",
		});
		expect(record.attributes.listing).toEqual({
			iddist: "200104",
			es_concesionario: true,
			es_dsv: false,
			es_serenazgo: null,
		});
	});

	it("drops the bare SI/NO police narrative and keeps the tally", () => {
		const record = toSratmaIncident({
			feature: LISTING_FEATURE,
			detail: POLICE_DETAIL,
			occurredAt: null,
			routeImpact: CONTEXT_ONLY,
			imageUrl: null,
		});
		expect(record.description).toBe(
			"1 fallecido · 0 lesionados · 2 vehículos · Reporta: OQUENDO",
		);
		expect(record.roadKm).toBeNull();
	});
});

describe("sratmaAccidentsSource", () => {
	const now = new Date("2026-10-17T17:20:00Z");
	const mediaBucket: MediaBucket = {
		listKeys: vi.fn(async () => ["sratma/accidents/22155.jpg"]),
		put: vi.fn(async () => {}),
		publicUrl: (key) => `https://media.test/${key}`,
	};
	const jpegBase64 = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0));

	function stubSratma(features: unknown[], photoStatus = 404) {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string) => {
				const url = new URL(input);
				const ipInput = url.searchParams.get("ipInput") ?? "";
				if (url.pathname.endsWith("/listarAccidenteMapa")) {
					return Response.json({ accidente: { features } });
				}
				if (url.pathname.endsWith("/listarAccidenteMapaInformacion")) {
					const { id_accidente_transito } = JSON.parse(ipInput);
					return Response.json(
						id_accidente_transito === 22668
							? POLICE_DETAIL
							: CONCESSIONAIRE_DETAIL,
					);
				}
				return photoStatus === 200
					? Response.json(jpegBase64)
					: new Response(null, { status: photoStatus });
			}),
		);
	}

	function runFetch() {
		return sratmaAccidentsSource.fetch({
			now,
			knownSourceIds: new Set(["22155"]),
			log: createLogger(),
			jevApiKey: "jev-key",
			mediaBucket,
			sratmaApiBase: "https://sratma-relay.test/wssratma/api/Mapa",
		});
	}

	beforeEach(() => {
		vi.mocked(classifyAccidentRoadStatus).mockReset();
		vi.mocked(mediaBucket.put).mockClear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("sends every request to the configured SRATMA base", async () => {
		stubSratma([LISTING_FEATURE], 200);
		await runFetch();
		const requestedUrls = vi
			.mocked(fetch)
			.mock.calls.map(([input]) => String(input));
		expect(requestedUrls.length).toBeGreaterThan(0);
		expect(
			requestedUrls.every((url) =>
				url.startsWith("https://sratma-relay.test/wssratma/api/Mapa/"),
			),
		).toBe(true);
	});

	it("asks Jev only for accidents inside the route impact window", async () => {
		stubSratma([
			LISTING_FEATURE,
			{ ...LISTING_FEATURE, properties: { id_accidente: 22668 } },
		]);
		vi.mocked(classifyAccidentRoadStatus).mockResolvedValue({
			roadStatus: "interrumpido",
			probabilities: null,
			confidence: null,
			model: "jev-latest",
		});
		const [old, recent] = await runFetch();
		expect(classifyAccidentRoadStatus).toHaveBeenCalledTimes(1);
		expect(
			vi.mocked(classifyAccidentRoadStatus).mock.calls[0]?.[1],
		).toMatchObject({ hoursSinceAccident: 5, deaths: 1 });
		expect(old).toMatchObject({ severity: "info", roadStatus: null });
		expect(recent).toMatchObject({
			severity: "critical",
			roadStatus: "interrumpido",
		});
	});

	it("fails open to warning when Jev cannot judge a recent accident", async () => {
		stubSratma([{ ...LISTING_FEATURE, properties: { id_accidente: 22668 } }]);
		vi.mocked(classifyAccidentRoadStatus).mockRejectedValue(
			new Error("timeout"),
		);
		const [recent] = await runFetch();
		expect(recent).toMatchObject({ severity: "warning", roadStatus: null });
	});

	it("reuses stored photos and uploads new ones by signature", async () => {
		stubSratma(
			[
				LISTING_FEATURE,
				{ ...LISTING_FEATURE, properties: { id_accidente: 22668 } },
			],
			200,
		);
		vi.mocked(classifyAccidentRoadStatus).mockRejectedValue(new Error("x"));
		const [stored, uploaded] = await runFetch();
		expect(stored?.imageUrl).toBe(
			"https://media.test/sratma/accidents/22155.jpg",
		);
		expect(uploaded?.imageUrl).toBe(
			"https://media.test/sratma/accidents/22668.jpg",
		);
		expect(mediaBucket.put).toHaveBeenCalledTimes(1);
		expect(vi.mocked(mediaBucket.put).mock.calls[0]?.[2]).toBe("image/jpeg");
	});

	it("keeps the accident without a photo when SRATMA answers 404", async () => {
		stubSratma([{ ...LISTING_FEATURE, properties: { id_accidente: 22668 } }]);
		vi.mocked(classifyAccidentRoadStatus).mockRejectedValue(new Error("x"));
		const [record] = await runFetch();
		expect(record?.imageUrl).toBeNull();
		expect(mediaBucket.put).not.toHaveBeenCalled();
	});

	it("refuses an empty listing instead of deactivating every accident", async () => {
		stubSratma([]);
		await expect(runFetch()).rejects.toThrow("no accidents");
	});
});
