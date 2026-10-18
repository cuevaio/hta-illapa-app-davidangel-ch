import {
	Color3,
	NullEngine,
	Ray,
	Scene,
	TransformNode,
	Vector3,
} from "@babylonjs/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneCamera } from "../camera";
import {
	CAMERA_MIN_RADIUS_M,
	HALF_RATIO,
	INITIAL_ELEVATION_M,
} from "../constants";
import { createStructureModel, type StructureModel } from "../models";
import { TerrainPointerSurface } from "../terrain-pointer-surface";
import {
	TEST_CURSOR_M,
	TEST_STRUCTURE,
	TEST_TABLE_POSITION_M,
	TEST_TABLE_SCALE_RATIO,
} from "./constants";
import { createTestProps } from "./props";
import { createTestTerrain } from "./terrain";

let engine: NullEngine;
let scene: Scene;
beforeEach(() => {
	engine = new NullEngine();
	scene = new Scene(engine);
	scene.useRightHandedSystem = true;
});
afterEach(() => {
	engine.dispose();
	vi.unstubAllGlobals();
});

describe("Babylon picking and camera requests", () => {
	it("routes ordinary Babylon ray picks through the terrain sampler under an XR world transform", () => {
		const terrain = createTestTerrain(scene);
		const localPoint = new Vector3(
			TEST_CURSOR_M.x,
			TEST_CURSOR_M.y,
			TEST_CURSOR_M.z,
		);
		const recordedRay = new Ray(Vector3.Zero(), Vector3.Zero());
		terrain.pick = (ray) => {
			recordedRay.origin.copyFrom(ray.origin);
			recordedRay.direction.copyFrom(ray.direction);
			return localPoint.clone();
		};
		const table = new TransformNode("table", scene);
		table.position.set(
			TEST_TABLE_POSITION_M.x,
			TEST_TABLE_POSITION_M.y,
			TEST_TABLE_POSITION_M.z,
		);
		table.scaling.setAll(TEST_TABLE_SCALE_RATIO);
		terrain.root.parent = table;
		new TerrainPointerSurface(scene, terrain);
		terrain.root.computeWorldMatrix(true);
		const worldPoint = Vector3.TransformCoordinates(
			localPoint,
			terrain.root.getWorldMatrix(),
		);
		const ray = new Ray(worldPoint.add(Vector3.Up()), Vector3.Down());
		const pick = scene.pickWithRay(ray);
		expect(pick?.hit).toBe(true);
		expect(pick?.pickedPoint?.x).toBeCloseTo(worldPoint.x);
		expect(pick?.pickedPoint?.y).toBeCloseTo(worldPoint.y);
		expect(pick?.pickedPoint?.z).toBeCloseTo(worldPoint.z);
		expect(recordedRay.origin.y).toBeCloseTo(ray.origin.y);
		expect(recordedRay.direction.length()).toBeCloseTo(1);
		expect(pick?.distance).toBeCloseTo(1);
	});

	it("applies focus_point instantly with reduced motion and deduplicates request IDs", () => {
		vi.stubGlobal("matchMedia", () => ({ matches: true }));
		const props = createTestProps();
		const terrain = createTestTerrain(scene);
		const controller = new SceneCamera(scene, terrain);
		const models = new Map<string, StructureModel>();
		props.cameraRequest = {
			kind: "focus_point",
			point: terrain.toGeo(TEST_CURSOR_M),
			requestId: 1,
		};
		controller.update(props, models, false);
		expect(controller.camera.target.x).toBeCloseTo(TEST_CURSOR_M.x);
		expect(controller.camera.target.z).toBeCloseTo(TEST_CURSOR_M.z);
		expect(controller.camera.radius).toBeCloseTo(CAMERA_MIN_RADIUS_M);
		props.cameraRequest = {
			kind: "focus_point",
			point: TEST_STRUCTURE.anchor,
			requestId: 1,
		};
		controller.update(props, models, false);
		expect(controller.camera.target.x).toBeCloseTo(TEST_CURSOR_M.x);
		props.cameraRequest = { ...props.cameraRequest, requestId: 2 };
		controller.update(props, models, false);
		expect(controller.camera.target.x).toBeCloseTo(0);
	});

	it("keeps the camera south of its target for north_up and frames exposure wider than a structure", () => {
		vi.stubGlobal("matchMedia", () => ({ matches: true }));
		const props = createTestProps();
		const terrain = createTestTerrain(scene);
		const controller = new SceneCamera(scene, terrain);
		const model = createStructureModel(
			scene,
			TEST_STRUCTURE,
			terrain,
			{ color: () => Color3.White(), css: () => "white" },
			new TransformNode("world", scene),
		);
		const models = new Map([[TEST_STRUCTURE.id, model]]);
		props.cameraRequest = {
			kind: "focus_structure",
			structureId: TEST_STRUCTURE.id,
			requestId: 1,
		};
		controller.update(props, models, false);
		const focusedRadiusM = controller.camera.radius;
		props.cameraRequest = {
			kind: "frame_exposure",
			structureId: TEST_STRUCTURE.id,
			radiusM: INITIAL_ELEVATION_M * HALF_RATIO,
			requestId: 2,
		};
		controller.update(props, models, false);
		expect(controller.camera.radius).toBeGreaterThan(focusedRadiusM);
		props.cameraRequest = { kind: "north_up", requestId: 3 };
		controller.update(props, models, false);
		expect(controller.camera.position.x).toBeCloseTo(
			controller.camera.target.x,
		);
		expect(controller.camera.position.z).toBeGreaterThan(
			controller.camera.target.z,
		);
	});
});
