import { DataTexture, Mesh, Texture, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { TRANSITION_MS } from "../constants";
import { createLocalFrame } from "../domain/local-frame";
import { ancestorUvTransform, childrenOf, tileKey } from "../domain/tile-math";
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
	it("maps every z16 and z17 subtile onto the shared z15 height texture", () => {
		const renderer = new TerrainRenderer(
			createLocalFrame(-76.39, -11.84),
			createSharedUniforms(),
		);
		const ancestor = { z: 15, x: 9430, y: 17469 };
		const descendants = childrenOf(ancestor).flatMap((child) => [
			child,
			...childrenOf(child),
		]);
		const textures = { height: () => height, imagery: () => undefined };
		for (const tile of [ancestor, ...descendants]) {
			renderer.setDisplay([tile], new Map(), textures, new Vector3(), 0);
			const uniforms = tileMeshes(renderer)[0]?.material.uniforms;
			const expectedUv = ancestorUvTransform(tile, ancestor);
			expect(uniforms?.uHeight.value).toBe(height.texture);
			expect(uniforms?.uHeightUv.value.toArray()).toEqual([
				expectedUv.offsetU,
				expectedUv.offsetV,
				expectedUv.scale,
			]);
			expect(uniforms?.uHeightTexel.value.toArray()).toEqual([
				1 / height.tile.width,
				1 / height.tile.height,
			]);
		}
		renderer.dispose();
	});

	it("keeps the nearest ancestor imagery after a missing tile finishes transitioning", () => {
		const renderer = new TerrainRenderer(
			createLocalFrame(-76.39, -11.84),
			createSharedUniforms(),
		);
		const ancestor = { z: 15, x: 9430, y: 17469 };
		const parent = { z: 16, x: ancestor.x * 2 + 1, y: ancestor.y * 2 };
		const child = { z: 17, x: parent.x * 2, y: parent.y * 2 + 1 };
		const ancestorTexture = new Texture();
		const parentTexture = new Texture();
		const textures = {
			height: () => height,
			imagery: (key: string) => ({
				texture:
					key === tileKey(ancestor)
						? ancestorTexture
						: key === tileKey(parent)
							? parentTexture
							: null,
				dispose() {},
			}),
		};
		renderer.setDisplay([ancestor], new Map(), textures, new Vector3(), 0);
		renderer.setDisplay([child], new Map(), textures, new Vector3(), 0);
		renderer.update(TRANSITION_MS);
		const uniforms = tileMeshes(renderer)[0]?.material.uniforms;
		expect(uniforms?.uImagery.value).toBe(parentTexture);
		expect(uniforms?.uHasImagery.value).toBe(1);
		expect(uniforms?.uImageryUv.value.toArray()).toEqual([0, 0.5, 0.5]);
		expect(uniforms?.uParentFade.value).toBe(0);
		textures.imagery = (key: string) => ({
			texture: key === tileKey(ancestor) ? ancestorTexture : null,
			dispose() {},
		});
		renderer.setDisplay(
			[child],
			new Map(),
			textures,
			new Vector3(),
			TRANSITION_MS,
		);
		expect(uniforms?.uImagery.value).toBe(ancestorTexture);
		expect(uniforms?.uImageryUv.value.toArray()).toEqual([0.5, 0.25, 0.25]);
		renderer.dispose();
	});

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
