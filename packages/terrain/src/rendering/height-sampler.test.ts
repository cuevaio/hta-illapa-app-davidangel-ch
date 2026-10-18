import { DataTexture } from "three";
import { describe, expect, it } from "vitest";
import { encodeHalfHeights } from "../domain/half-float";
import { mercatorToLonLat, tileBoundsMercator } from "../domain/tile-math";
import { HeightSampler } from "./height-sampler";
import type { HeightResource } from "./tile-resources";

const resource: HeightResource = {
	texture: new DataTexture(),
	tile: {
		heights: encodeHalfHeights(new Float32Array([-100, 0, 100, 200]), -100),
		offset: -100,
		width: 2,
		height: 2,
		min: -100,
		max: 200,
	},
	dispose() {},
};

describe("CPU height sampling", () => {
	it("returns null without cached coverage", () => {
		const sampler = new HeightSampler(() => undefined, 15);
		expect(sampler.sample(-75, -9.5)).toBeNull();
	});

	it("bilinearly samples the same edge-aligned half-floats as the shader", () => {
		const sampler = new HeightSampler(
			(key) => (key === "0/0/0" ? resource : undefined),
			15,
		);
		const bounds = tileBoundsMercator({ z: 0, x: 0, y: 0 });
		const point = mercatorToLonLat(
			bounds.minX + (bounds.maxX - bounds.minX) / 4,
			bounds.maxY - (bounds.maxY - bounds.minY) / 4,
		);
		expect(sampler.sample(point.lon, point.lat)).toBeCloseTo(-25, 6);
		expect(sampler.sample(0, 0)).toBeCloseTo(50, 6);
	});

	it("uses the finest cached tile before ancestors and preserves negative elevation", () => {
		const sampler = new HeightSampler(
			(key) => (key === "1/0/0" || key === "0/0/0" ? resource : undefined),
			15,
		);
		const bounds = tileBoundsMercator({ z: 1, x: 0, y: 0 });
		const point = mercatorToLonLat(bounds.minX, bounds.maxY);
		expect(sampler.sample(point.lon, point.lat)).toBeCloseTo(-100, 6);
	});
});
