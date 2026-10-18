import {
	Color3,
	Matrix,
	NullEngine,
	Ray,
	Scene,
	TransformNode,
	Vector3,
	Viewport,
} from "@babylonjs/core";
import { Rectangle, TextBlock } from "@babylonjs/gui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneCamera } from "../camera";
import {
	HALF_RATIO,
	HANDLE_CHIP_OFFSET_PX,
	LABEL_HEIGHT_PX,
	LANDMARK_FADE_DISTANCE_M,
	LANDMARK_LABEL_OFFSET_PX,
	LANDMARK_MAX_DISTANCE_M,
	LANDMARK_OPACITY_RATIO,
} from "../constants";
import { SceneEditing } from "../editing";
import { createStructureModel } from "../models";
import { SceneLabels } from "../overlays";
import {
	TEST_FONT_ASCENT_PX,
	TEST_FONT_DESCENT_PX,
	TEST_GROUND_M,
	TEST_STRUCTURE,
	TEST_VIEW_HEIGHT_PX,
	TEST_VIEW_WIDTH_PX,
} from "./constants";
import { LayoutCanvas } from "./layout-canvas";
import { createTestProps } from "./props";
import { createTestTerrain } from "./terrain";

let engine: NullEngine;
let scene: Scene;
beforeEach(() => {
	engine = new NullEngine({
		renderWidth: TEST_VIEW_WIDTH_PX,
		renderHeight: TEST_VIEW_HEIGHT_PX,
		textureSize: TEST_VIEW_WIDTH_PX,
		deterministicLockstep: false,
		lockstepMaxSteps: 1,
	});
	vi.spyOn(engine, "createCanvas").mockImplementation(
		(width, height) => new LayoutCanvas(width, height),
	);
	vi.spyOn(engine, "getFontOffset").mockReturnValue({
		ascent: TEST_FONT_ASCENT_PX,
		descent: TEST_FONT_DESCENT_PX,
		height: TEST_FONT_ASCENT_PX + TEST_FONT_DESCENT_PX,
	});
	scene = new Scene(engine);
	scene.useRightHandedSystem = true;
});
afterEach(() => {
	engine.dispose();
	vi.restoreAllMocks();
});

describe("Babylon scene label layout", () => {
	it("keeps a structure label at a bounded pixel height and projects it at its actual anchor", () => {
		const terrain = createTestTerrain(scene);
		const props = createTestProps();
		const parent = new TransformNode("world", scene);
		const camera = new SceneCamera(scene, terrain);
		const labels = new SceneLabels(scene, terrain, parent);
		const model = createStructureModel(
			scene,
			TEST_STRUCTURE,
			terrain,
			{ color: () => Color3.White(), css: () => "white" },
			parent,
		);
		labels.rebuild(props, new Map([[TEST_STRUCTURE.id, model]]), {
			color: () => Color3.White(),
			css: () => "white",
		});
		scene.updateTransformMatrix(true);
		labels.tick(camera);
		labels.texture._checkUpdate(camera.camera);
		labels.texture.markAsDirty();
		labels.texture._checkUpdate(camera.camera);
		const control = labels.texture.rootContainer.children.find(
			(control) =>
				control instanceof Rectangle &&
				control.children.some(
					(child) =>
						child instanceof TextBlock && child.text === TEST_STRUCTURE.name,
				),
		);
		if (!(control instanceof Rectangle))
			throw new Error("Missing structure label");
		expect(control.heightInPixels).toBeLessThanOrEqual(LABEL_HEIGHT_PX);
		expect(control.isVisible).toBe(true);
		expect(control.notRenderable).toBe(false);
		const anchor = control.linkedMesh;
		if (!anchor) throw new Error("Missing label anchor");
		expect(anchor.isDisposed()).toBe(false);
		const expected = Vector3.Project(
			new Vector3(anchor.position.x, anchor.position.y, anchor.position.z),
			Matrix.IdentityReadOnly,
			scene.getTransformMatrix(),
			new Viewport(0, 0, TEST_VIEW_WIDTH_PX, TEST_VIEW_HEIGHT_PX),
		);
		expect(control.centerX).toBeCloseTo(expected.x);
		expect(control.centerY).toBeCloseTo(expected.y);
	});

	it("does not leave a permanent measurement rectangle beside the selected structure", () => {
		const terrain = createTestTerrain(scene);
		const props = createTestProps();
		const parent = new TransformNode("world", scene);
		new SceneCamera(scene, terrain);
		const labels = new SceneLabels(scene, terrain, parent);
		const model = createStructureModel(
			scene,
			TEST_STRUCTURE,
			terrain,
			{ color: () => Color3.White(), css: () => "white" },
			parent,
		);
		labels.rebuild(props, new Map([[TEST_STRUCTURE.id, model]]), {
			color: () => Color3.White(),
			css: () => "white",
		});
		const measurements = labels.texture.rootContainer.children.filter(
			(control) =>
				control instanceof Rectangle &&
				control.children.some(
					(child) =>
						child instanceof TextBlock &&
						child.text.includes(props.labels.span),
				),
		);
		expect(measurements).toHaveLength(0);
	});

	it("shows a bounded measurement pill only during a desktop handle drag and links it above that handle", () => {
		const props = createTestProps();
		const terrain = {
			...createTestTerrain(scene),
			pick: () => new Vector3(0, TEST_GROUND_M, 0),
		};
		const parent = new TransformNode("world", scene);
		const camera = new SceneCamera(scene, terrain);
		const labels = new SceneLabels(scene, terrain, parent);
		const palette = { color: () => Color3.White(), css: () => "white" };
		const model = createStructureModel(
			scene,
			TEST_STRUCTURE,
			terrain,
			palette,
			parent,
		);
		const editing = new SceneEditing({
			scene,
			terrain,
			parent,
			camera,
			getProps: () => props,
			linkLabel(control, mesh) {
				labels.texture.addControl(control);
				control.linkWithMesh(mesh);
			},
			onDraft() {},
			onDragging() {},
		});
		editing.rebuild(TEST_STRUCTURE, model, palette, false);
		const activeHandle = [...editing.targets].find(
			([, target]) => target.index === 0 && !target.insert && !target.remove,
		)?.[0];
		if (!activeHandle) throw new Error("Missing handle");
		editing.begin({ index: 0, insert: false, remove: false }, 1);
		editing.move(new Ray(Vector3.Zero(), Vector3.Down()), 1);
		scene.updateTransformMatrix(true);
		editing.tick(false);
		activeHandle.computeWorldMatrix(true);
		labels.texture._checkUpdate(camera.camera);
		labels.texture.markAsDirty();
		labels.texture._checkUpdate(camera.camera);
		const chip = labels.texture.rootContainer.children.find(
			(control) => control.name === "handle-drag-chip",
		);
		if (!(chip instanceof Rectangle))
			throw new Error("Missing handle drag chip");
		expect(chip.heightInPixels).toBeLessThanOrEqual(LABEL_HEIGHT_PX);
		expect(chip.notRenderable).toBe(false);
		expect(chip.widthInPixels).toBeLessThan(TEST_VIEW_WIDTH_PX);
		expect(chip.linkedMesh).toBe(activeHandle);
		expect(chip.linkOffsetYInPixels).toBe(-HANDLE_CHIP_OFFSET_PX);
		expect(
			chip.children.some(
				(control) =>
					control instanceof TextBlock &&
					control.text.includes(props.labels.span),
			),
		).toBe(true);
		expect(chip.isVisible).toBe(true);
		editing.tick(true);
		expect(chip.isVisible).toBe(false);
		editing.tick(false);
		editing.end(1);
		expect(chip.isVisible).toBe(false);
		editing.dispose();
	});

	it("projects a quiet landmark above the terrain in an overview", () => {
		const terrain = createTestTerrain(scene);
		const props = createTestProps();
		props.structures = [];
		props.selectedStructureId = null;
		props.landmarks = [{ name: "Matucana", ...TEST_STRUCTURE.anchor }];
		const parent = new TransformNode("world", scene);
		const camera = new SceneCamera(scene, terrain);
		const labels = new SceneLabels(scene, terrain, parent);
		labels.rebuild(props, new Map(), {
			color: () => Color3.White(),
			css: () => "white",
		});
		scene.updateTransformMatrix(true);
		labels.tick(camera);
		labels.texture._checkUpdate(camera.camera);
		labels.texture.markAsDirty();
		labels.texture._checkUpdate(camera.camera);
		const control = labels.texture.rootContainer.children.find(
			(control) => control instanceof Rectangle,
		);
		if (!(control instanceof Rectangle))
			throw new Error("Missing landmark label");
		expect(control.linkedMesh?.getAbsolutePosition().y).toBeGreaterThan(
			TEST_GROUND_M,
		);
		expect(control.notRenderable).toBe(false);
		expect(control.isVisible).toBe(true);
		expect(control.heightInPixels).toBeLessThanOrEqual(LABEL_HEIGHT_PX);
		const anchor = control.linkedMesh;
		if (!anchor) throw new Error("Missing landmark anchor");
		camera.camera.position.copyFrom(anchor.position);
		camera.camera.position.y +=
			(LANDMARK_FADE_DISTANCE_M + LANDMARK_MAX_DISTANCE_M) * HALF_RATIO;
		labels.tick(camera);
		expect(control.alpha).toBeCloseTo(LANDMARK_OPACITY_RATIO * HALF_RATIO);
		expect(control.isVisible).toBe(true);
		camera.camera.position.y = anchor.position.y + LANDMARK_MAX_DISTANCE_M;
		labels.tick(camera);
		expect(control.alpha).toBe(0);
		expect(control.isVisible).toBe(false);
	});

	it("keeps a nearby landmark visible beside the selected structure in an overview", () => {
		const terrain = createTestTerrain(scene);
		const props = createTestProps();
		props.landmarks = [{ name: "Matucana", ...TEST_STRUCTURE.anchor }];
		const parent = new TransformNode("world", scene);
		const camera = new SceneCamera(scene, terrain);
		const labels = new SceneLabels(scene, terrain, parent);
		const palette = { color: () => Color3.White(), css: () => "white" };
		const model = createStructureModel(
			scene,
			TEST_STRUCTURE,
			terrain,
			palette,
			parent,
		);
		labels.rebuild(props, new Map([[TEST_STRUCTURE.id, model]]), palette);
		scene.updateTransformMatrix(true);
		labels.tick(camera);
		labels.texture._checkUpdate(camera.camera);
		labels.texture.markAsDirty();
		labels.texture._checkUpdate(camera.camera);
		const landmark = labels.texture.rootContainer.children.find(
			(control) =>
				control instanceof Rectangle &&
				control.children.some(
					(child) => child instanceof TextBlock && child.text === "Matucana",
				),
		);
		if (!(landmark instanceof Rectangle)) throw new Error("Missing landmark");
		expect(landmark.isVisible).toBe(true);
		expect(landmark.notRenderable).toBe(false);
		expect(landmark.alpha).toBeGreaterThan(0);
		expect(landmark.linkOffsetYInPixels).toBe(LANDMARK_LABEL_OFFSET_PX);
		labels.setVisible(false);
		expect(labels.texture.rootContainer.isVisible).toBe(false);
	});

	it("re-links rebuilt labels to live anchors and keeps the fullscreen layer hidden throughout XR", () => {
		const terrain = createTestTerrain(scene);
		const props = createTestProps();
		const parent = new TransformNode("world", scene);
		const palette = { color: () => Color3.White(), css: () => "white" };
		new SceneCamera(scene, terrain);
		const labels = new SceneLabels(scene, terrain, parent);
		const model = createStructureModel(
			scene,
			TEST_STRUCTURE,
			terrain,
			palette,
			parent,
		);
		labels.rebuild(props, new Map([[TEST_STRUCTURE.id, model]]), palette);
		const previous = labels.texture.rootContainer.children.find(
			(control) => control instanceof Rectangle,
		)?.linkedMesh;
		labels.setVisible(false);
		model.dispose();
		const updated = { ...TEST_STRUCTURE, name: "Puente Habich" };
		props.structures = [updated];
		const replacement = createStructureModel(
			scene,
			updated,
			terrain,
			palette,
			parent,
		);
		labels.rebuild(props, new Map([[updated.id, replacement]]), palette);
		const control = labels.texture.rootContainer.children.find(
			(control) =>
				control instanceof Rectangle &&
				control.children.some(
					(child) => child instanceof TextBlock && child.text === updated.name,
				),
		);
		if (!(control instanceof Rectangle))
			throw new Error("Missing rebuilt label");
		expect(previous?.isDisposed()).toBe(true);
		expect(control.linkedMesh).not.toBe(previous);
		expect(control.linkedMesh?.getScene()).toBe(scene);
		expect(control.linkedMesh?.isDisposed()).toBe(false);
		expect(labels.texture.rootContainer.isVisible).toBe(false);
		expect(labels.texture.layer?.isBackground).toBe(false);
		labels.setVisible(true);
		expect(labels.texture.rootContainer.isVisible).toBe(true);
	});
});
