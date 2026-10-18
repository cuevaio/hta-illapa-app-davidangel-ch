import {
	Color3,
	NullEngine,
	Scene,
	TransformNode,
	Vector3,
} from "@babylonjs/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneStructure } from "../../../lib/structure-scene";
import { SceneCamera } from "../camera";
import {
	CAMERA_FLIGHT_DURATION_MS,
	CAMERA_INITIAL_RADIUS_M,
	CAMERA_MAX_BETA_RAD,
} from "../constants";
import { createStructureModel } from "../models";
import {
	TEST_CAMERA_BYPASS_HALF_LENGTH_M,
	TEST_CAMERA_BYPASS_LANE_COUNT,
	TEST_CAMERA_BYPASS_LANE_WIDTH_M,
	TEST_CAMERA_CLEARANCE_RATIO,
	TEST_CAMERA_FLIGHT_ALTITUDE_M,
	TEST_CAMERA_FLIGHT_HALF_LENGTH_M,
	TEST_CAMERA_FLIGHT_STEPS_COUNT,
	TEST_CAMERA_MIN_CLEARANCE_M,
	TEST_CAMERA_RIDGE_HALF_WIDTH_M,
	TEST_CAMERA_RIDGE_HEIGHT_M,
	TEST_CAMERA_SLOPE_RATIO,
	TEST_GROUND_M,
	TEST_STRUCTURE,
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
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("Babylon camera terrain clearance", () => {
	it("frames a sloped bypass above the hillside after ArcRotateCamera rebuilds its position", () => {
		vi.stubGlobal("matchMedia", () => ({ matches: true }));
		const terrain = createTestTerrain(
			scene,
			(point) => TEST_GROUND_M + Math.max(0, point.x) * TEST_CAMERA_SLOPE_RATIO,
		);
		const structure: SceneStructure = {
			...TEST_STRUCTURE,
			anchor: { ...TEST_STRUCTURE.anchor, elevationM: TEST_GROUND_M },
			template: {
				kind: "bypass",
				laneCount: TEST_CAMERA_BYPASS_LANE_COUNT,
				laneWidthM: TEST_CAMERA_BYPASS_LANE_WIDTH_M,
				points: [
					{ x: -TEST_CAMERA_BYPASS_HALF_LENGTH_M, y: 0, z: 0 },
					{
						x: TEST_CAMERA_BYPASS_HALF_LENGTH_M,
						y: TEST_CAMERA_BYPASS_HALF_LENGTH_M * TEST_CAMERA_SLOPE_RATIO,
						z: 0,
					},
				],
			},
			elements: [],
		};
		const props = createTestProps();
		props.structures = [structure];
		props.cameraRequest = {
			kind: "focus_structure",
			structureId: structure.id,
			requestId: 1,
		};
		const controller = new SceneCamera(scene, terrain);
		const model = createStructureModel(
			scene,
			structure,
			terrain,
			{
				color: () => Color3.White(),
				css: () => "white",
			},
			new TransformNode("world", scene),
		);
		controller.update(props, new Map([[structure.id, model]]), false);
		controller.tick(props.insets, false);
		controller.camera.getViewMatrix(true);
		const groundM =
			terrain.heightAt(controller.camera.position) ?? TEST_GROUND_M;
		expect(controller.camera.position.y - groundM).toBeGreaterThanOrEqual(
			Math.max(
				TEST_CAMERA_MIN_CLEARANCE_M,
				controller.camera.radius * TEST_CAMERA_CLEARANCE_RATIO,
			),
		);
	});

	it("clears intervening ridges throughout an animated focus flight", () => {
		let nowMs = 0;
		vi.spyOn(performance, "now").mockImplementation(() => nowMs);
		const terrain = createTestTerrain(
			scene,
			(point) =>
				TEST_GROUND_M +
				(Math.abs(point.x) < TEST_CAMERA_RIDGE_HALF_WIDTH_M
					? TEST_CAMERA_RIDGE_HEIGHT_M
					: 0),
		);
		const controller = new SceneCamera(scene, terrain);
		const props = createTestProps();
		controller.camera.setTarget(
			new Vector3(-TEST_CAMERA_FLIGHT_HALF_LENGTH_M, TEST_GROUND_M, 0),
		);
		controller.camera.setPosition(
			new Vector3(
				-TEST_CAMERA_FLIGHT_HALF_LENGTH_M,
				TEST_GROUND_M + TEST_CAMERA_FLIGHT_ALTITUDE_M,
				0,
			),
		);
		props.cameraRequest = {
			kind: "focus_point",
			requestId: 1,
			point: terrain.toGeo({ x: TEST_CAMERA_FLIGHT_HALF_LENGTH_M, z: 0 }),
		};
		controller.update(props, new Map(), false);
		for (let step = 1; step <= TEST_CAMERA_FLIGHT_STEPS_COUNT; step++) {
			nowMs =
				(CAMERA_FLIGHT_DURATION_MS * step) / TEST_CAMERA_FLIGHT_STEPS_COUNT;
			controller.tick(props.insets, false);
			controller.camera.getViewMatrix(true);
			const groundM =
				terrain.heightAt(controller.camera.position) ?? TEST_GROUND_M;
			expect(controller.camera.position.y - groundM).toBeGreaterThanOrEqual(
				Math.max(
					TEST_CAMERA_MIN_CLEARANCE_M,
					controller.camera.radius * TEST_CAMERA_CLEARANCE_RATIO,
				),
			);
		}
	});

	it("clamps the current orbit position before rendering after input changes its angles", () => {
		const terrain = createTestTerrain(
			scene,
			(point) => TEST_GROUND_M + Math.max(0, point.x) * TEST_CAMERA_SLOPE_RATIO,
		);
		const controller = new SceneCamera(scene, terrain);
		const props = createTestProps();
		controller.cancel();
		controller.camera.setPosition(
			new Vector3(
				-CAMERA_INITIAL_RADIUS_M,
				TEST_GROUND_M + CAMERA_INITIAL_RADIUS_M,
				0,
			),
		);
		controller.camera.getViewMatrix(true);
		controller.camera.alpha = 0;
		controller.camera.beta = CAMERA_MAX_BETA_RAD;
		controller.camera.radius = CAMERA_INITIAL_RADIUS_M;
		scene.onBeforeRenderObservable.add(() =>
			controller.tick(props.insets, false),
		);
		scene.render();
		const groundM =
			terrain.heightAt(controller.camera.position) ?? TEST_GROUND_M;
		expect(controller.camera.position.y - groundM).toBeGreaterThanOrEqual(
			Math.max(
				TEST_CAMERA_MIN_CLEARANCE_M,
				controller.camera.radius * TEST_CAMERA_CLEARANCE_RATIO,
			),
		);
	});
});
