import {
	type Camera,
	FreeCamera,
	Matrix,
	Mesh,
	NullEngine,
	Ray,
	Scene,
	TransformNode,
	Vector3,
} from "@babylonjs/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	LOD_MIN_INTERVAL_MS,
	MAX_ELEVATION_ZOOM_LEVEL,
	MAX_IMAGERY_ZOOM_LEVEL,
} from "../constants";
import { createLocalFrame, mercatorToLocal } from "../domain/local-frame";
import { tileBoundsMercator } from "../domain/tile-math";
import type { TileId } from "../domain/types";
import type { DecodedHeightTile } from "../infrastructure/decode-protocol";
import { LocalCameraView } from "./camera-view";
import { createBabylonTerrain } from "./terrain";
import { TerrainMaterial } from "./terrain-material";
import type { BabylonTerrain } from "./types";

const {
	terminatedWorker,
	closedBitmap,
	heightRequests,
	imageryRequests,
	requestSignals,
} = vi.hoisted(() => ({
	terminatedWorker: vi.fn(),
	closedBitmap: vi.fn(),
	heightRequests: new Map<string, TileId>(),
	imageryRequests: new Map<string, TileId>(),
	requestSignals: new Set<AbortSignal>(),
}));

vi.mock("../infrastructure/tile-sources", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("../infrastructure/tile-sources")>();
	return {
		...original,
		loadHeightTile: async (
			_pool: unknown,
			tile: TileId,
			signal: AbortSignal,
		): Promise<DecodedHeightTile> => {
			heightRequests.set(`${tile.z}/${tile.x}/${tile.y}`, tile);
			requestSignals.add(signal);
			return {
				heights: new Uint16Array(4),
				offset: 2000,
				width: 2,
				height: 2,
				min: 2000,
				max: 2000,
			};
		},
		loadImageryTile: async (
			tile: TileId,
			signal: AbortSignal,
		): Promise<ImageBitmap> => {
			imageryRequests.set(`${tile.z}/${tile.x}/${tile.y}`, tile);
			requestSignals.add(signal);
			return { width: 2, height: 2, close: closedBitmap };
		},
	};
});

let engine: NullEngine;
let scene: Scene;
let clock = vi.fn<() => number>();
let elapsedMs: number;

beforeEach(() => {
	vi.stubGlobal("navigator", { hardwareConcurrency: 2 });
	vi.stubGlobal(
		"Worker",
		class {
			terminate = terminatedWorker;
		},
	);
	engine = new NullEngine();
	scene = new Scene(engine);
	scene.useRightHandedSystem = true;
	clock = vi.fn<() => number>().mockReturnValue(0);
	vi.spyOn(performance, "now").mockImplementation(clock);
	elapsedMs = 0;
	heightRequests.clear();
	imageryRequests.clear();
	requestSignals.clear();
	terminatedWorker.mockClear();
	closedBitmap.mockClear();
});

afterEach(() => {
	scene.dispose();
	engine.dispose();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

async function advanceTerrain(
	terrain: BabylonTerrain,
	camera: Camera,
	frames: number,
) {
	for (let frameIndex = 0; frameIndex < frames; frameIndex++) {
		clock.mockReturnValue(elapsedMs);
		terrain.update(camera);
		elapsedMs += LOD_MIN_INTERVAL_MS;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

it("streams, clips, picks in root metres and disposes under a changing tabletop transform", async () => {
	const onTilesLoaded = vi.fn();
	const origin = { lat: -13.163, lng: -72.545 };
	const terrain = createBabylonTerrain({ scene, origin, onTilesLoaded });
	const parent = new TransformNode("table", scene);
	parent.position.set(2, 1, -3);
	parent.rotation.y = 0.8;
	parent.scaling.setAll(1 / 1000);
	terrain.root.parent = parent;
	terrain.root.computeWorldMatrix(true);
	const rootMatrix = terrain.root.getWorldMatrix();
	const camera = new FreeCamera(
		"camera",
		Vector3.TransformCoordinates(new Vector3(0, 10_000, 8000), rootMatrix),
		scene,
	);
	camera.minZ = 0.01;
	camera.maxZ = 100;
	camera.setTarget(
		Vector3.TransformCoordinates(new Vector3(0, 2000, 0), rootMatrix),
	);
	const localOrigin = terrain.toLocal(origin);
	expect(localOrigin.x).toBeCloseTo(0);
	expect(localOrigin.z).toBeCloseTo(0);
	expect(terrain.toGeo(localOrigin)).toEqual({
		lat: expect.closeTo(origin.lat),
		lng: expect.closeTo(origin.lng),
	});
	expect(terrain.heightAt(localOrigin)).toBeNull();
	terrain.setClip({ center: localOrigin, sizeM: 1000 });
	terrain.setOpacity(0.35);
	await advanceTerrain(terrain, camera, 3);
	expect(onTilesLoaded).toHaveBeenCalled();
	expect(terrain.root.getChildMeshes().length).toBeGreaterThan(0);
	expect(terrain.heightAt({ x: 100, z: 100 })).toBe(2000);
	const localRay = new Ray(new Vector3(100, 4000, 100), new Vector3(0, -1, 0));
	let worldRay = Ray.Transform(localRay, terrain.root.getWorldMatrix());
	const hit = terrain.pick(worldRay);
	expect(hit?.x).toBeCloseTo(100, 2);
	expect(hit?.y).toBeCloseTo(2000, 2);
	expect(hit?.z).toBeCloseTo(100, 2);
	const outsideRay = Ray.Transform(
		new Ray(new Vector3(1000, 4000, 0), new Vector3(0, -1, 0)),
		terrain.root.getWorldMatrix(),
	);
	expect(terrain.pick(outsideRay)).toBeNull();
	parent.position.set(-2, 2, 4);
	parent.rotation.y = -0.4;
	parent.scaling.setAll(1 / 2000);
	terrain.root.computeWorldMatrix(true);
	worldRay = Ray.Transform(localRay, terrain.root.getWorldMatrix());
	expect(terrain.pick(worldRay)?.y).toBeCloseTo(2000, 2);
	expect(terrain.pick(worldRay)?.x).toBeCloseTo(100, 2);
	const frame = createLocalFrame(origin.lng, origin.lat);
	for (const tile of imageryRequests.values()) {
		const bounds = tileBoundsMercator(tile);
		const northwest = mercatorToLocal(frame, bounds.minX, bounds.maxY);
		const southeast = mercatorToLocal(frame, bounds.maxX, bounds.minY);
		expect(northwest.x).toBeLessThan(500);
		expect(northwest.z).toBeLessThan(500);
		expect(southeast.x).toBeGreaterThan(-500);
		expect(southeast.z).toBeGreaterThan(-500);
		expect(tile.z).toBeLessThanOrEqual(MAX_ELEVATION_ZOOM_LEVEL);
	}
	terrain.setOpacity(1);
	for (const mesh of terrain.root.getChildMeshes()) {
		if (!(mesh instanceof Mesh) || !(mesh.material instanceof TerrainMaterial))
			throw new Error("Expected terrain mesh");
		expect(mesh.material.needAlphaBlending()).toBe(false);
		expect(mesh.material.disableDepthWrite).toBe(false);
	}
	expect(() => terrain.setOpacity(2)).toThrow();
	expect(() => terrain.setClip({ center: localOrigin, sizeM: 0 })).toThrow();
	const textures = [...scene.textures];
	const materials = [...scene.materials];
	terrain.dispose();
	terrain.dispose();
	expect(closedBitmap).toHaveBeenCalledTimes(imageryRequests.size);
	expect(terminatedWorker).toHaveBeenCalledTimes(1);
	expect(parent.getChildren()).toHaveLength(0);
	expect(terrain.root.isDisposed()).toBe(true);
	expect(terrain.root.getChildMeshes()).toHaveLength(0);
	expect(scene.textures).toHaveLength(0);
	expect(scene.meshes).toHaveLength(0);
	expect(scene.geometries).toHaveLength(0);
	for (const texture of textures) expect(scene.textures).not.toContain(texture);
	for (const material of materials)
		expect(scene.materials).not.toContain(material);
	expect(terrain.heightAt(localOrigin)).toBeNull();
	expect(terrain.pick(worldRay)).toBeNull();
});

it("refines to z17 imagery using only z15 elevation and can remove a clip", async () => {
	const terrain = createBabylonTerrain({
		scene,
		origin: { lat: -11.84, lng: -76.39 },
	});
	const camera = new FreeCamera("camera", new Vector3(0, 2200, 200), scene);
	camera.minZ = 1;
	camera.maxZ = 10_000;
	camera.setTarget(new Vector3(0, 2000, 0));
	terrain.setClip({ center: { x: 0, z: 0 }, sizeM: 1000 });
	await advanceTerrain(terrain, camera, 20);
	expect(Math.max(...[...imageryRequests.values()].map((tile) => tile.z))).toBe(
		MAX_ELEVATION_ZOOM_LEVEL,
	);
	terrain.setClip(null);
	await advanceTerrain(terrain, camera, 60);
	expect(Math.max(...[...imageryRequests.values()].map((tile) => tile.z))).toBe(
		MAX_IMAGERY_ZOOM_LEVEL,
	);
	expect(Math.max(...[...heightRequests.values()].map((tile) => tile.z))).toBe(
		MAX_ELEVATION_ZOOM_LEVEL,
	);
	expect(terrain.heightAt({ x: 0, z: 0 })).toBe(2000);
	expect(
		terrain.pick(new Ray(new Vector3(0, 2500, 0), new Vector3(0, -1, 0)))?.y,
	).toBeCloseTo(2000);
	terrain.dispose();
});

it("uses the camera global position and first rig projection in local space", () => {
	const parent = new TransformNode("camera-parent", scene);
	parent.position.set(4, 3, 2);
	const camera = new FreeCamera("head", new Vector3(1, 2, 3), scene);
	camera.parent = parent;
	const eye = new FreeCamera("eye", Vector3.Zero(), scene);
	const projection = Matrix.PerspectiveFovRH(0.7, 1, 0.1, 100);
	eye.freezeProjectionMatrix(projection);
	camera.rigCameras.push(eye);
	const rootMatrix = Matrix.Scaling(0.001, 0.001, 0.001).multiply(
		Matrix.Translation(2, 1, -3),
	);
	const view = new LocalCameraView();
	view.update(camera, rootMatrix);
	expect(view.position.x).toBeCloseTo(3000, 2);
	expect(view.position.y).toBeCloseTo(4000, 2);
	expect(view.position.z).toBeCloseTo(8000, 2);
	expect(view.fovYRadians).toBeCloseTo(0.7);
	expect(
		view.clipMatrix.equals(
			rootMatrix.multiply(camera.getViewMatrix()).multiply(projection),
		),
	).toBe(true);
});

it("aborts requests and suppresses late loads after disposal", async () => {
	const uploadedImagery = vi.spyOn(engine, "createTexture");
	const uploadedHeights = vi.spyOn(engine, "createRawTexture");
	const onTilesLoaded = vi.fn();
	const terrain = createBabylonTerrain({
		scene,
		origin: { lat: -11.84, lng: -76.39 },
		onTilesLoaded,
	});
	const camera = new FreeCamera("camera", new Vector3(0, 2500, 200), scene);
	camera.setTarget(new Vector3(0, 2000, 0));
	terrain.update(camera);
	uploadedHeights.mockClear();
	terrain.dispose();
	const callbacksAtDisposal = onTilesLoaded.mock.calls.length;
	expect(requestSignals.size).toBeGreaterThan(0);
	expect([...requestSignals].every((signal) => signal.aborted)).toBe(true);
	await new Promise((resolve) => setTimeout(resolve, LOD_MIN_INTERVAL_MS));
	expect(onTilesLoaded).toHaveBeenCalledTimes(callbacksAtDisposal);
	expect(uploadedImagery).not.toHaveBeenCalled();
	expect(uploadedHeights).not.toHaveBeenCalled();
	expect(scene.textures).toHaveLength(0);
	expect(closedBitmap).toHaveBeenCalledTimes(imageryRequests.size);
});
