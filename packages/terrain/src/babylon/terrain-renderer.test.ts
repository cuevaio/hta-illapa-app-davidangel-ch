import {
	Material,
	Mesh,
	NullEngine,
	RawTexture,
	Scene,
	Texture,
	Vector3,
} from "@babylonjs/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRANSITION_MS } from "../constants";
import { createLocalFrame } from "../domain/local-frame";
import { ancestorUvTransform, childrenOf, tileKey } from "../domain/tile-math";
import { createSharedUniforms, TerrainMaterial } from "./terrain-material";
import { TerrainRenderer } from "./terrain-renderer";
import type { HeightResource } from "./tile-resources";

let engine: NullEngine;
let scene: Scene;
let height: HeightResource;
beforeEach(() => {
	engine = new NullEngine();
	scene = new Scene(engine);
	scene.useRightHandedSystem = true;
	height = {
		texture: RawTexture.CreateRTexture(new Float32Array(4), 2, 2, scene),
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
});
afterEach(() => {
	scene.dispose();
	engine.dispose();
});

function tileMeshes(renderer: TerrainRenderer) {
	return renderer.root
		.getChildMeshes()
		.filter((mesh) => mesh.isEnabled())
		.map((mesh) => {
			if (
				!(mesh instanceof Mesh) ||
				!(mesh.material instanceof TerrainMaterial)
			)
				throw new Error("Expected terrain mesh");
			return { mesh, material: mesh.material };
		});
}

describe("terrain rendering resources", () => {
	it("maps every z16 and z17 subtile onto the shared z15 height texture", () => {
		const renderer = new TerrainRenderer(
			scene,
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
			expect(uniforms?.uHeightUv.value.asArray()).toEqual([
				expectedUv.offsetU,
				expectedUv.offsetV,
				expectedUv.scale,
			]);
			expect(uniforms?.uHeightTexel.value.asArray()).toEqual([
				1 / height.tile.width,
				1 / height.tile.height,
			]);
		}
		renderer.dispose();
	});

	it("keeps the nearest ancestor imagery after a missing tile finishes transitioning", () => {
		const renderer = new TerrainRenderer(
			scene,
			createLocalFrame(-76.39, -11.84),
			createSharedUniforms(),
		);
		const ancestor = { z: 15, x: 9430, y: 17469 };
		const parent = { z: 16, x: ancestor.x * 2 + 1, y: ancestor.y * 2 };
		const child = { z: 17, x: parent.x * 2, y: parent.y * 2 + 1 };
		const ancestorTexture = new Texture(null, scene);
		const parentTexture = new Texture(null, scene);
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
		expect(uniforms?.uImageryUv.value.asArray()).toEqual([0, 0.5, 0.5]);
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
		expect(uniforms?.uImageryUv.value.asArray()).toEqual([0.5, 0.25, 0.25]);
		renderer.dispose();
	});

	it("keeps existing, pooled and future materials consistent when opacity changes", () => {
		const renderer = new TerrainRenderer(
			scene,
			createLocalFrame(-75, -9.5),
			createSharedUniforms(),
		);
		const parent = { z: 5, x: 9, y: 16 };
		const textures = { height: () => height, imagery: () => undefined };
		renderer.setDisplay([parent], new Map(), textures, new Vector3(), 0);
		const original = tileMeshes(renderer)[0];
		expect(original?.material.needAlphaBlending()).toBe(false);
		expect(original?.material.disableDepthWrite).toBe(false);
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
		expect(children.map((entry) => entry.mesh)).toContain(original?.mesh);
		expect(children).toHaveLength(4);
		expect(new Set(children.map((entry) => entry.mesh.geometry)).size).toBe(1);
		expect(scene.geometries).toHaveLength(1);
		for (const mesh of children) {
			expect(mesh.material.alpha).toBe(0.35);
			expect(mesh.material.sideOrientation).toBe(
				Material.CounterClockWiseSideOrientation,
			);
			expect(mesh.material.uniforms.uOpacity.value).toBe(0.35);
			expect(mesh.material.needAlphaBlending()).toBe(true);
			expect(mesh.material.disableDepthWrite).toBe(true);
		}
		renderer.setOpacity(1);
		for (const mesh of children) {
			expect(mesh.material.uniforms.uOpacity.value).toBe(1);
			expect(mesh.material.needAlphaBlending()).toBe(false);
			expect(mesh.material.disableDepthWrite).toBe(false);
		}
		renderer.dispose();
		expect(renderer.root.getChildMeshes()).toHaveLength(0);
	});

	it("cross-fades replacement imagery and releases the ancestor after the transition", () => {
		const renderer = new TerrainRenderer(
			scene,
			createLocalFrame(-75, -9.5),
			createSharedUniforms(),
		);
		const parent = { z: 5, x: 9, y: 16 };
		const parentTexture = new Texture(null, scene);
		const childTexture = new Texture(null, scene);
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
