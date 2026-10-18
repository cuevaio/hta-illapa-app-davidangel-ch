import { afterEach, expect, it, vi } from "vitest";
import { IMAGERY_SOURCE, loadImageryTile } from "./tile-sources";

afterEach(() => {
	vi.unstubAllGlobals();
});

it("requests Esri imagery at z17 in zoom/row/column order", async () => {
	const tile = { z: 17, x: 37723, y: 69878 };
	const bitmap = { close: vi.fn() };
	const imageBlob = new Blob();
	const fetchImagery = vi.fn(async () => ({
		ok: true,
		blob: async () => imageBlob,
	}));
	const decodeImagery = vi.fn(async () => bitmap);
	vi.stubGlobal("fetch", fetchImagery);
	vi.stubGlobal("createImageBitmap", decodeImagery);
	const controller = new AbortController();
	expect(IMAGERY_SOURCE.maxZoom).toBe(17);
	expect(await loadImageryTile(tile, controller.signal)).toBe(bitmap);
	expect(fetchImagery).toHaveBeenCalledExactlyOnceWith(
		"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/17/69878/37723",
		{ signal: controller.signal, mode: "cors" },
	);
	expect(decodeImagery).toHaveBeenCalledExactlyOnceWith(imageBlob);
});
