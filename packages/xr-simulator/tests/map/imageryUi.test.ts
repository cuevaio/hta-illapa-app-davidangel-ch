import { describe, expect, it, vi } from "vitest";
import {
	IMAGERY_HINTS,
	PROTOTYPE_NOTICE,
	resolveImagery,
} from "../../src/map/imagery/imagerySource";
import { TileLayer } from "../../src/map/lod/tileLayer";
import {
	defaultImageryMode,
	imageryToggleState,
} from "../../src/ui/web/ImageryToggle";

describe("Relieve / Satélite switch state", () => {
	it("without a usable provider Satélite is disabled with its hint and Relieve stays", () => {
		const a = resolveImagery({ VITE_IMAGERY_PROVIDER: "esri" });
		expect(defaultImageryMode(a)).toBe("relief");
		expect(imageryToggleState(a, "satellite")).toEqual({
			mode: "relief",
			satelliteDisabled: true,
			hint: IMAGERY_HINTS.noKey,
			credit: null,
			notice: null,
		});
	});

	it("attribution and the prototype notice show only while imagery is visible", () => {
		const a = resolveImagery({});
		expect(defaultImageryMode(a)).toBe("satellite");
		expect(imageryToggleState(a, "relief")).toMatchObject({
			credit: null,
			notice: null,
			satelliteDisabled: false,
		});
		const s = imageryToggleState(a, "satellite");
		expect(s.credit).toContain("Esri");
		expect(s.credit).toContain("Powered by Esri");
		expect(s.notice).toBe(PROTOTYPE_NOTICE);
		expect(imageryToggleState(a, "satellite", "Source: Esri, X").credit).toBe(
			"Imagen: Source: Esri, X · Powered by Esri",
		);
		const keyed = resolveImagery({ VITE_IMAGERY_KEY: "k" });
		expect(imageryToggleState(keyed, "satellite").notice).toBeNull();
	});
});

describe("imagery cache", () => {
	it("evicting or clearing imagery tiles disposes their GPU textures; the working set is never evicted", async () => {
		const disposed: string[] = [];
		const layer = new TileLayer({
			capacity: 2,
			maxConcurrent: 4,
			load: async (t) => ({
				texture: {},
				dispose: () => disposed.push(`${t.z}/${t.x}/${t.y}`),
			}),
		});
		const req = (x: number) => ({
			tile: { z: 12, x, y: 0 },
			key: `12/${x}/0`,
			priority: x,
		});
		layer.update([req(1), req(2)], new Set());
		await vi.waitFor(() => expect(layer.stats.cached).toBe(2));
		layer.update([req(3)], new Set(["12/2/0"]));
		await vi.waitFor(() => expect(layer.isReady("12/3/0")).toBe(true));
		expect(disposed).toEqual(["12/1/0"]);
		layer.clear();
		expect(disposed.sort()).toEqual(["12/1/0", "12/2/0", "12/3/0"]);
	});
});
