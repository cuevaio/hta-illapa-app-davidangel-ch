import {
	ArrayCamera,
	Group,
	Mesh,
	PerspectiveCamera,
	Ray,
	type Texture,
	type Vector2,
	Vector3,
	WebGLRenderer,
} from "three";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LOD_MIN_INTERVAL_MS } from "./constants";
import type { DecodedHeightTile } from "./infrastructure/decode-protocol";
import { TerrainMaterial } from "./rendering/terrain-material";
import { createTerrain } from "./terrain";

const {
	disposedTexture,
	terminatedWorker,
	requestedHeightZooms,
	requestedImageryZooms,
} = vi.hoisted(() => ({
	disposedTexture: vi.fn(),
	terminatedWorker: vi.fn(),
	requestedHeightZooms: new Set<number>(),
	requestedImageryZooms: new Set<number>(),
}));

vi.mock("three", async (importOriginal) => {
	const original = await importOriginal<typeof import("three")>();
	return {
		...original,
		WebGLRenderer: class {
			capabilities = { getMaxAnisotropy: () => 4 };
			getPixelRatio() {
				return 1;
			}
			getDrawingBufferSize(target: Vector2) {
				return target.set(1000, 1000);
			}
			initTexture(texture: Texture) {
				texture.addEventListener("dispose", disposedTexture);
			}
		},
	};
});

vi.mock("./infrastructure/tile-sources", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("./infrastructure/tile-sources")>();
	return {
		...original,
		loadHeightTile: async (
			_pool: unknown,
			tile: { z: number },
		): Promise<DecodedHeightTile> => {
			requestedHeightZooms.add(tile.z);
			return {
				heights: new Uint16Array(4),
				offset: 2000,
				width: 2,
				height: 2,
				min: 2000,
				max: 2000,
			};
		},
		loadImageryTile: async (tile: { z: number }): Promise<ImageBitmap> => {
			requestedImageryZooms.add(tile.z);
			return {
				width: 2,
				height: 2,
				close() {},
			};
		},
	};
});

beforeEach(() => {
	vi.stubGlobal("navigator", { hardwareConcurrency: 2 });
	vi.stubGlobal(
		"Worker",
		class {
			terminate = terminatedWorker;
		},
	);
	requestedHeightZooms.clear();
	requestedImageryZooms.clear();
	disposedTexture.mockClear();
	terminatedWorker.mockClear();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

it("streams, picks and disposes through the public API under a tabletop transform", async () => {
	const now = vi.spyOn(performance, "now").mockReturnValue(0);
	const onTilesLoaded = vi.fn();
	const terrain = createTerrain({
		renderer: new WebGLRenderer(),
		origin: { lat: -13.163, lng: -72.545 },
		onTilesLoaded,
	});
	const parent = new Group();
	parent.position.set(2, 1, -3);
	parent.rotation.y = 0.8;
	parent.scale.setScalar(1 / 1000);
	parent.add(terrain.group);
	parent.updateMatrixWorld(true);
	const camera = new PerspectiveCamera(50, 1, 0.01, 100);
	camera.position.copy(parent.localToWorld(new Vector3(0, 10_000, 8000)));
	camera.lookAt(parent.localToWorld(new Vector3(0, 2000, 0)));
	camera.updateMatrixWorld();
	const localOrigin = terrain.toLocal({ lat: -13.163, lng: -72.545 });
	expect(localOrigin.x).toBeCloseTo(0);
	expect(localOrigin.z).toBeCloseTo(0);
	expect(terrain.toGeo(localOrigin)).toEqual({
		lat: expect.closeTo(-13.163),
		lng: expect.closeTo(-72.545),
	});
	expect(terrain.heightAt({ x: 0, z: 0 })).toBeNull();
	expect(
		terrain.pick(new Ray(new Vector3(0, 4000, 0), new Vector3(0, -1, 0))),
	).toBeNull();
	terrain.setClip({ center: { x: 0, z: 0 }, sizeM: 1000 });
	terrain.setOpacity(0.35);
	terrain.update(camera);
	await new Promise((resolve) => setTimeout(resolve, 0));
	now.mockReturnValue(LOD_MIN_INTERVAL_MS);
	terrain.update(camera);
	expect(onTilesLoaded).toHaveBeenCalled();
	expect(terrain.group.children.length).toBeGreaterThan(0);
	expect(terrain.heightAt({ x: 100, z: 100 })).toBe(2000);
	const localRay = new Ray(new Vector3(100, 4000, 100), new Vector3(0, -1, 0));
	const worldRay = localRay.clone().applyMatrix4(terrain.group.matrixWorld);
	const hit = terrain.pick(worldRay);
	expect(hit?.x).toBeCloseTo(100);
	expect(hit?.y).toBeCloseTo(2000);
	expect(hit?.z).toBeCloseTo(100);
	const outsideRay = new Ray(
		new Vector3(1000, 4000, 0),
		new Vector3(0, -1, 0),
	).applyMatrix4(terrain.group.matrixWorld);
	expect(terrain.pick(outsideRay)).toBeNull();
	const xrCamera = new ArrayCamera([camera]);
	xrCamera.matrixWorld.copy(camera.matrixWorld);
	xrCamera.matrixWorldInverse.copy(camera.matrixWorldInverse);
	now.mockReturnValue(LOD_MIN_INTERVAL_MS * 2);
	terrain.update(xrCamera);
	expect(xrCamera.matrixWorld.equals(camera.matrixWorld)).toBe(true);

	terrain.setOpacity(1);
	for (const child of terrain.group.children) {
		expect(child).toBeInstanceOf(Mesh);
		if (
			!(child instanceof Mesh) ||
			!(child.material instanceof TerrainMaterial)
		)
			throw new Error("Expected terrain mesh");
		expect(child.material.transparent).toBe(false);
		expect(child.material.depthWrite).toBe(true);
	}
	expect(() => terrain.setOpacity(2)).toThrow();
	expect(() => terrain.setClip({ center: { x: 0, z: 0 }, sizeM: 0 })).toThrow();
	terrain.dispose();
	terrain.dispose();
	expect(disposedTexture).toHaveBeenCalled();
	expect(terminatedWorker).toHaveBeenCalledTimes(1);
	expect(parent.children).toHaveLength(0);
	expect(terrain.group.children).toHaveLength(0);
	expect(terrain.heightAt({ x: 0, z: 0 })).toBeNull();
	expect(terrain.pick(worldRay)).toBeNull();
});

it("refines engineering views to real z17 imagery while retaining z15 elevation", async () => {
	const now = vi.spyOn(performance, "now").mockReturnValue(0);
	const terrain = createTerrain({
		renderer: new WebGLRenderer(),
		origin: { lat: -11.84, lng: -76.39 },
	});
	const camera = new PerspectiveCamera(50, 1, 1, 10_000);
	camera.position.set(0, 2200, 200);
	camera.lookAt(0, 2000, 0);
	for (let frameIndex = 0; frameIndex < 60; frameIndex++) {
		now.mockReturnValue(frameIndex * LOD_MIN_INTERVAL_MS);
		terrain.update(camera);
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	try {
		expect(requestedImageryZooms.has(16)).toBe(true);
		expect(requestedImageryZooms.has(17)).toBe(true);
		expect(Math.max(...requestedImageryZooms)).toBe(17);
		expect(Math.max(...requestedHeightZooms)).toBe(15);
		expect(terrain.heightAt({ x: 0, z: 0 })).toBe(2000);
		expect(
			terrain.pick(new Ray(new Vector3(0, 2500, 0), new Vector3(0, -1, 0)))?.y,
		).toBeCloseTo(2000);
	} finally {
		terrain.dispose();
	}
});
