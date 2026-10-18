import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ESRI_PLACEHOLDER_BYTES,
	fetchImageryAttribution,
	IMAGERY_HINTS,
	type ImagerySource,
	imageryBinding,
	imageryCredit,
	imageryPlan,
	imageryQuadMaxZoom,
	loadImageryParts,
	PROTOTYPE_NOTICE,
	resolveImagery,
} from "../../src/map/imagery/imagerySource";
import { tileKey } from "../../src/map/lod/quadtree";
import { tilesBaseUrl } from "../../src/map/tilesClient";

const KEY = "AAPK-secret-key-123";
const jpeg = (bytes = 9000) =>
	new Response(new Uint8Array(bytes), {
		status: 200,
		headers: { "Content-Type": "image/jpeg" },
	});
const fakeBitmap = () =>
	({ close: vi.fn(), width: 256, height: 256 }) as unknown as ImageBitmap;
const decode = async () => fakeBitmap();
const source = (
	provider: "esri" | "esri-prototipo" = "esri",
	key: string | undefined = KEY,
): ImagerySource => {
	const a = resolveImagery({
		VITE_IMAGERY_PROVIDER: provider,
		VITE_IMAGERY_KEY: key,
	});
	if (!a.available) throw new Error(a.hint);
	return a.source;
};

afterEach(() => vi.restoreAllMocks());

describe("imagery provider configuration", () => {
	it("esri with a key: authenticated Location Platform World Imagery, token appended, z/y/x order", () => {
		const s = source("esri");
		expect(s.url({ z: 17, x: 37000, y: 66000 })).toBe(
			`https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/17/66000/37000?token=${KEY}`,
		);
		expect(s.maxZoom).toBe(19);
		expect(s.notice).toBeNull();
	});

	it("the key is URL-encoded", () => {
		const a = resolveImagery({
			VITE_IMAGERY_PROVIDER: "esri",
			VITE_IMAGERY_KEY: "a b&c",
		});
		expect(a.available && a.source.url({ z: 1, x: 0, y: 1 })).toMatch(
			/\?token=a%20b%26c$/,
		);
	});

	it("esri without a key is disabled with the Spanish hint and never falls back to the anonymous endpoint", () => {
		for (const key of [undefined, "", "   "]) {
			const a = resolveImagery({
				VITE_IMAGERY_PROVIDER: "esri",
				VITE_IMAGERY_KEY: key,
			});
			expect(a.available).toBe(false);
			expect(!a.available && a.hint).toBe(
				"Imagen satelital: requiere una clave del proveedor (VITE_IMAGERY_KEY en .env.local)",
			);
		}
	});

	it("defaults: esri-prototipo (keyless, public endpoint) without a key, esri with a key", () => {
		const anon = resolveImagery({});
		expect(anon.available && anon.source.provider).toBe("esri-prototipo");
		expect(
			anon.available && anon.source.url({ z: 19, x: 147000, y: 270000 }),
		).toBe(
			"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/19/270000/147000",
		);
		expect(anon.available && anon.source.notice).toBe(PROTOTYPE_NOTICE);
		const keyed = resolveImagery({ VITE_IMAGERY_KEY: KEY });
		expect(keyed.available && keyed.source.provider).toBe("esri");
	});

	it("only the explicit esri-prototipo provider calls Esri anonymously (no token in its URLs)", () => {
		const s = source("esri-prototipo", undefined);
		expect(s.url({ z: 5, x: 9, y: 16 })).not.toContain("token");
		expect(s.notice).toContain("modo prototipo (sin clave)");
	});

	it("none disables imagery; maptiler/google are documented stubs; unknown providers are rejected", () => {
		expect(
			resolveImagery({ VITE_IMAGERY_PROVIDER: "none", VITE_IMAGERY_KEY: KEY }),
		).toEqual({ available: false, provider: "none", hint: IMAGERY_HINTS.none });
		for (const p of ["maptiler", "google"]) {
			const a = resolveImagery({
				VITE_IMAGERY_PROVIDER: p,
				VITE_IMAGERY_KEY: KEY,
			});
			expect(a.available).toBe(false);
			expect(!a.available && a.hint).toBe(
				`Imagen satelital: proveedor «${p}» no implementado`,
			);
		}
		const u = resolveImagery({
			VITE_IMAGERY_PROVIDER: "bing",
			VITE_IMAGERY_KEY: KEY,
		});
		expect(!u.available && u.hint).toContain("desconocido");
		// No hint ever echoes the key.
		for (const p of ["none", "esri", "maptiler", "google", "bing"]) {
			const a = resolveImagery({
				VITE_IMAGERY_PROVIDER: p,
				VITE_IMAGERY_KEY: KEY,
			});
			if (!a.available) expect(a.hint).not.toContain(KEY);
		}
	});

	it("never targets our tiles backend", () => {
		for (const s of [source("esri"), source("esri-prototipo", undefined)]) {
			const url = s.url({ z: 10, x: 300, y: 540 });
			expect(url.startsWith(tilesBaseUrl({}))).toBe(false);
			expect(new URL(url).hostname).toMatch(/arcgis(online)?\.com$/);
		}
	});
});

describe("imagery attribution", () => {
	it('Esri data sources plus "Powered by Esri", and the prototype notice only in prototype mode', () => {
		expect(imageryCredit(source("esri"))).toEqual({
			text: "Imagen: Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community · Powered by Esri",
			notice: null,
		});
		expect(imageryCredit(source("esri-prototipo", undefined)).notice).toBe(
			PROTOTYPE_NOTICE,
		);
	});

	it("prefers the dynamic copyrightText of the service metadata, falling back to the static text", async () => {
		const s = source("esri");
		const urls: string[] = [];
		const ok = await fetchImageryAttribution(s, async (u) => {
			urls.push(String(u));
			return new Response(
				JSON.stringify({ copyrightText: "Source: Esri, NewCo" }),
			);
		});
		expect(ok).toBe("Source: Esri, NewCo");
		expect(urls[0]).toBe(
			`https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer?f=json&token=${KEY}`,
		);
		expect(
			await fetchImageryAttribution(
				s,
				async () => new Response('{"error":{"code":499}}'),
			),
		).toBe(s.attribution);
		expect(
			await fetchImageryAttribution(s, async () => {
				throw new TypeError("Failed to fetch");
			}),
		).toBe(s.attribution);
	});
});

describe("imagery mosaic (512 px terrain tile ↔ 256 px provider tiles)", () => {
	it("desktop: a z tile is the 2×2 provider tiles of z+1 laid out NW, NE, SW, SE", () => {
		const p = imageryPlan({ z: 11, x: 600, y: 1100 }, 512, 19);
		expect(p.size).toBe(512);
		expect(p.parts).toEqual([
			{ tile: { z: 12, x: 1200, y: 2200 }, x: 0, y: 0 },
			{ tile: { z: 12, x: 1201, y: 2200 }, x: 256, y: 0 },
			{ tile: { z: 12, x: 1200, y: 2201 }, x: 0, y: 256 },
			{ tile: { z: 12, x: 1201, y: 2201 }, x: 256, y: 256 },
		]);
	});

	it("quest: one provider tile at the same zoom (256 px)", () => {
		expect(imageryPlan({ z: 8, x: 75, y: 136 }, 256, 19)).toEqual({
			size: 256,
			parts: [{ tile: { z: 8, x: 75, y: 136 }, x: 0, y: 0 }],
		});
	});

	it("the quadtree may refine for imagery up to the provider max zoom (mosaic level included)", () => {
		expect(imageryQuadMaxZoom(19, 512)).toBe(18);
		expect(imageryQuadMaxZoom(19, 256)).toBe(19);
		expect(() => imageryPlan({ z: 19, x: 0, y: 0 }, 512, 19)).toThrow();
	});
});

describe("imagery loading", () => {
	const plan = imageryPlan({ z: 16, x: 18900, y: 34400 }, 512, 19);

	it("fetches every part from the provider and decodes it", async () => {
		const urls: string[] = [];
		const r = await loadImageryParts(
			source("esri"),
			plan,
			new AbortController().signal,
			async (u) => {
				urls.push(String(u));
				return jpeg();
			},
			decode,
		);
		expect(r.kind).toBe("ready");
		expect(urls).toHaveLength(4);
		expect(urls.every((u) => u.includes("/tile/17/"))).toBe(true);
	});

	it('the "Map data not yet available" placeholder (2 521 B) makes the tile unavailable and frees decoded parts', async () => {
		const bitmaps: ImageBitmap[] = [];
		let n = 0;
		const r = await loadImageryParts(
			source("esri-prototipo", undefined),
			plan,
			new AbortController().signal,
			async () => jpeg(n++ === 2 ? ESRI_PLACEHOLDER_BYTES : 9000),
			async () => {
				const b = fakeBitmap();
				bitmaps.push(b);
				return b;
			},
		);
		expect(r.kind).toBe("unavailable");
		for (const b of bitmaps) expect(b.close).toHaveBeenCalled();
	});

	it("404 is unavailable; other HTTP errors and non-images throw without the URL or key", async () => {
		const s = source("esri");
		const sig = new AbortController().signal;
		expect(
			(
				await loadImageryParts(
					s,
					plan,
					sig,
					async () => new Response("", { status: 404 }),
					decode,
				)
			).kind,
		).toBe("unavailable");
		const errors: unknown[] = [];
		for (const f of [
			async () => new Response("", { status: 500 }),
			async () =>
				new Response('{"error":{"code":498,"message":"Invalid token."}}', {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			async () => {
				throw new TypeError(`Failed to fetch ${s.url({ z: 1, x: 0, y: 0 })}`);
			},
		]) {
			try {
				await loadImageryParts(s, plan, sig, f, decode);
			} catch (e) {
				errors.push(e);
			}
		}
		expect(errors).toHaveLength(3);
		for (const e of errors) {
			const msg =
				String((e as Error).message) +
				String((e as Error).stack ?? "") +
				JSON.stringify(e);
			expect(msg).not.toContain(KEY);
			expect(msg).not.toContain("arcgis");
			expect((e as Error).cause).toBeUndefined();
		}
	});

	it("nothing it logs contains the key", async () => {
		const spies = (["log", "warn", "error", "info", "debug"] as const).map(
			(m) => vi.spyOn(console, m).mockImplementation(() => {}),
		);
		const s = source("esri");
		const sig = new AbortController().signal;
		await loadImageryParts(s, plan, sig, async () => jpeg(), decode);
		await loadImageryParts(
			s,
			plan,
			sig,
			async () => new Response("", { status: 404 }),
			decode,
		);
		await loadImageryParts(
			s,
			plan,
			sig,
			async () => new Response("", { status: 503 }),
			decode,
		).catch(() => {});
		await fetchImageryAttribution(s, async () => {
			throw new Error("x");
		});
		for (const spy of spies)
			for (const call of spy.mock.calls)
				expect(JSON.stringify(call.map(String))).not.toContain(KEY);
	});
});

describe("imagery binding (parent fallback)", () => {
	it("uses the tile own imagery when ready, else the nearest ready ancestor with its uv sub-rectangle", () => {
		const t = { z: 12, x: 1201, y: 2203 };
		expect(imageryBinding(t, () => true)).toEqual({
			key: tileKey(t),
			offsetU: 0,
			offsetV: 0,
			scale: 1,
		});
		const b = imageryBinding(t, (k) => k === "10/300/550");
		expect(b).toEqual({
			key: "10/300/550",
			offsetU: 0.25,
			offsetV: 0.75,
			scale: 0.25,
		});
		expect(imageryBinding(t, () => false)).toBeNull();
	});
});
