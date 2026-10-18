import { Constants, NullEngine, Scene, Texture } from "@babylonjs/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encodeHalfHeights } from "../domain/half-float";
import type { DecodedHeightTile } from "../infrastructure/decode-protocol";
import { TileResourceFactory } from "./tile-resources";

let engine: NullEngine;
let scene: Scene;
const tile: DecodedHeightTile = {
	heights: encodeHalfHeights(new Float32Array([-100, 0, 100, 200]), -100),
	offset: -100,
	width: 2,
	height: 2,
	min: -100,
	max: 200,
};

beforeEach(() => {
	engine = new NullEngine();
	scene = new Scene(engine);
});

afterEach(() => {
	scene.dispose();
	engine.dispose();
	vi.restoreAllMocks();
});

it("uploads shared half-float data as a clamped R16F texture", () => {
	Object.assign(engine.getCaps(), {
		textureHalfFloat: true,
		textureHalfFloatLinearFiltering: true,
	});
	const upload = vi.spyOn(engine, "createRawTexture");
	const resource = new TileResourceFactory(scene).createHeight(tile);
	expect(upload.mock.calls[0]?.[0]).toBe(tile.heights);
	expect(resource.texture.textureType).toBe(Constants.TEXTURETYPE_HALF_FLOAT);
	expect(resource.texture.textureFormat).toBe(Constants.TEXTUREFORMAT_R);
	expect(resource.texture.samplingMode).toBe(Texture.BILINEAR_SAMPLINGMODE);
	expect(resource.texture.invertY).toBe(false);
	expect(resource.texture.wrapU).toBe(Texture.CLAMP_ADDRESSMODE);
	expect(resource.texture.wrapV).toBe(Texture.CLAMP_ADDRESSMODE);
	resource.dispose();
	expect(scene.textures).toHaveLength(0);
});

it("decodes half-float residuals into R32F when half-float uploads are unavailable", () => {
	Object.assign(engine.getCaps(), {
		textureHalfFloat: false,
		textureFloat: true,
		textureFloatLinearFiltering: true,
	});
	const upload = vi.spyOn(engine, "createRawTexture");
	const resource = new TileResourceFactory(scene).createHeight(tile);
	expect(upload.mock.calls[0]?.[0]).toEqual(
		new Float32Array([0, 100, 200, 300]),
	);
	expect(resource.texture.textureType).toBe(Constants.TEXTURETYPE_FLOAT);
	expect(resource.texture.textureFormat).toBe(Constants.TEXTUREFORMAT_R);
	expect(resource.tile.offset).toBe(-100);
	resource.dispose();
});

it("keeps imagery uploads distinct and releases each decoded bitmap", () => {
	const factory = new TileResourceFactory(scene);
	const close = vi.fn();
	const bitmap = { width: 2, height: 2, close };
	const first = factory.createImagery(bitmap);
	const second = factory.createImagery(bitmap);
	expect(first.texture?.getInternalTexture()).not.toBe(
		second.texture?.getInternalTexture(),
	);
	expect(first.texture?.invertY).toBe(false);
	expect(first.texture?.gammaSpace).toBe(false);
	first.dispose();
	second.dispose();
	expect(close).toHaveBeenCalledTimes(2);
	expect(scene.textures).toHaveLength(0);
});
