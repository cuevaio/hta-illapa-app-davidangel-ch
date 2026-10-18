import { DataTexture, Mesh, Texture, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { TRANSITION_MS } from "../constants";
import { createLocalFrame } from "../domain/local-frame";
import { childrenOf, tileKey } from "../domain/tile-math";
import { createSharedUniforms, TerrainMaterial } from "./terrain-material";
import { TerrainRenderer } from "./terrain-renderer";
import type { HeightResource } from "./tile-resources";

const height: HeightResource = {
	texture: new DataTexture(),
	tile: {
		heights: new Uint16Array(4),
		offset: 2000,
		width: 2,
		height: 2,
		min: 2000,
		max: 2000,
	},
	dispose() {},
};

function tileMeshes(renderer: TerrainRenderer) {
	return renderer.group.children.filter(
		(child): child is Mesh<import("three").BufferGeometry, TerrainMaterial> =>
			child instanceof Mesh && child.material instanceof TerrainMaterial,
	);
}

describe("terrain rendering resources", () => {
	it("keeps existing, pooled and future materials consistent when opacity changes", () => {
		const renderer = new TerrainRenderer(
			createLocalFrame(-75, -9.5),
			createSharedUniforms(),
		);
		const parent = { z: 5, x: 9, y: 16 };
		const textures = { height: () => height, imagery: () => undefined };
		renderer.setDisplay([parent], new Map(), textures, new Vector3(), 0);
		const original = tileMeshes(renderer)[0];
		expect(original?.material.transparent).toBe(false);
		expect(original?.material.depthWrite).toBe(true);
		renderer.setDisplay([], new Map(), textures, new Vector3(), 0);
		renderer.setOpacity(0.35);
		renderer.setDisplay(
			childrenOf(parent),
			new Map(),
			textures,
			new Vector3(),
			0,
		);
		const children = tileMeshes(renderer);
		expect(children).toContain(original);
		expect(children).toHaveLength(4);
		for (const mesh of children) {
			expect(mesh.material.opacity).toBe(0.35);
			expect(mesh.material.uniforms.uOpacity.value).toBe(0.35);
			expect(mesh.material.transparent).toBe(true);
			expect(mesh.material.depthWrite).toBe(false);
		}
		renderer.setOpacity(1);
		for (const mesh of children) {
			expect(mesh.material.uniforms.uOpacity.value).toBe(1);
			expect(mesh.material.transparent).toBe(false);
			expect(mesh.material.depthWrite).toBe(true);
		}
		renderer.dispose();
		expect(renderer.group.children).toHaveLength(0);
	});

	it("cross-fades replacement imagery and releases the ancestor after the transition", () => {
		const renderer = new TerrainRenderer(
			createLocalFrame(-75, -9.5),
			createSharedUniforms(),
		);
		const parent = { z: 5, x: 9, y: 16 };
		const parentTexture = new Texture();
		const childTexture = new Texture();
		const textures = {
			height: () => height,
			imagery: (key: string) => ({
				texture: key === tileKey(parent) ? parentTexture : childTexture,
				dispose() {},
			}),
		};
		renderer.setDisplay([parent], new Map(), textures, new Vector3(), 0);
		renderer.setDisplay(
			childrenOf(parent),
			new Map(),
			textures,
			new Vector3(),
			0,
		);
		expect(renderer.fadeSourceKeys).toEqual(new Set([tileKey(parent)]));
		expect(renderer.transitioning).toBe(true);
		for (const mesh of tileMeshes(renderer)) {
			expect(mesh.material.uniforms.uMorph.value).toBe(0);
			expect(mesh.material.uniforms.uParentImagery.value).toBe(parentTexture);
			expect(mesh.material.uniforms.uParentFade.value).toBe(1);
		}
		renderer.update(TRANSITION_MS);
		expect(renderer.fadeSourceKeys.size).toBe(0);
		expect(renderer.transitioning).toBe(false);
		for (const mesh of tileMeshes(renderer)) {
			expect(mesh.material.uniforms.uMorph.value).toBe(1);
			expect(mesh.material.uniforms.uParentImagery.value).toBeNull();
		}
		renderer.dispose();
	});
});
