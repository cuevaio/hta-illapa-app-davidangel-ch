import {
	Color3,
	NullEngine,
	Ray,
	Scene,
	TransformNode,
	Vector3,
} from "@babylonjs/core";
import { MAX_BYPASS_POINTS } from "@hack-the-andes-project/business/structures/constants";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneCamera } from "../camera";
import { SceneEditing } from "../editing";
import { createStructureModel, type ScenePalette } from "../models";
import { snapHandlePoint } from "../placement";
import { TEST_CURSOR_M, TEST_STRUCTURE } from "./constants";
import { createTestProps } from "./props";
import { createTestTerrain } from "./terrain";

const palette: ScenePalette = {
	color: () => Color3.White(),
	css: () => "#ffffff",
};
let engine: NullEngine;
let scene: Scene;
beforeEach(() => {
	engine = new NullEngine();
	scene = new Scene(engine);
	scene.useRightHandedSystem = true;
});
afterEach(() => engine.dispose());

describe("Babylon editing", () => {
	it("keeps handle edits local until one release, ignores other pointers, and cancels cleanly", () => {
		const props = createTestProps();
		const terrain = {
			...createTestTerrain(scene),
			pick: () =>
				new Vector3(TEST_CURSOR_M.x, TEST_CURSOR_M.y, TEST_CURSOR_M.z),
		};
		const parent = new TransformNode("world", scene);
		const model = createStructureModel(
			scene,
			TEST_STRUCTURE,
			terrain,
			palette,
			parent,
		);
		const onDraft = vi.fn();
		const editing = new SceneEditing({
			scene,
			terrain,
			parent,
			camera: new SceneCamera(scene, terrain),
			getProps: () => props,
			linkLabel() {},
			onDraft,
			onDragging() {},
		});
		editing.rebuild(TEST_STRUCTURE, model, palette, false);
		const ray = new Ray(Vector3.Zero(), Vector3.Down());
		expect(editing.begin({ index: 0, insert: false, remove: false }, 1)).toBe(
			true,
		);
		editing.move(ray, 2);
		expect(onDraft).not.toHaveBeenCalled();
		editing.move(ray, 1);
		editing.move(ray, 1);
		expect(props.onStructureChange).not.toHaveBeenCalled();
		expect(editing.end(2)).toBe(false);
		expect(editing.end(1)).toBe(true);
		expect(editing.end(1)).toBe(false);
		expect(props.onStructureChange).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				template: expect.objectContaining({
					start: snapHandlePoint(terrain, TEST_STRUCTURE, TEST_CURSOR_M),
				}),
			}),
		);
		editing.begin({ index: 1, insert: false, remove: false }, 1);
		editing.move(ray, 1);
		editing.cancel();
		expect(editing.end(1)).toBe(false);
		expect(props.onStructureChange).toHaveBeenCalledTimes(1);
		editing.dispose();
	});

	it("inserts one bypass vertex per midpoint drag and omits insertion handles at the point limit", () => {
		const props = createTestProps();
		const terrain = {
			...createTestTerrain(scene),
			pick: () =>
				new Vector3(TEST_CURSOR_M.x, TEST_CURSOR_M.y, TEST_CURSOR_M.z),
		};
		const parent = new TransformNode("world", scene);
		if (TEST_STRUCTURE.template.kind !== "bridge")
			throw new Error("Missing fixture bridge");
		const structure = {
			...TEST_STRUCTURE,
			template: {
				kind: "bypass",
				points: [TEST_STRUCTURE.template.start, TEST_STRUCTURE.template.end],
				laneCount: 2,
				laneWidthM: 3,
			},
		} satisfies typeof TEST_STRUCTURE;
		props.structures = [structure];
		const model = createStructureModel(
			scene,
			structure,
			terrain,
			palette,
			parent,
		);
		const editing = new SceneEditing({
			scene,
			terrain,
			parent,
			camera: new SceneCamera(scene, terrain),
			getProps: () => props,
			linkLabel() {},
			onDraft() {},
			onDragging() {},
		});
		editing.rebuild(structure, model, palette, false);
		const ray = new Ray(Vector3.Zero(), Vector3.Down());
		editing.begin({ index: 1, insert: true, remove: false }, 1);
		editing.move(ray, 1);
		editing.move(ray, 1);
		editing.end(1);
		expect(props.onStructureChange).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				template: expect.objectContaining({
					points: [
						structure.template.points[0],
						snapHandlePoint(terrain, structure, TEST_CURSOR_M),
						structure.template.points[1],
					],
				}),
			}),
		);
		const full = {
			...structure,
			template: {
				...structure.template,
				points: Array.from({ length: MAX_BYPASS_POINTS }, () => TEST_CURSOR_M),
			},
		};
		editing.rebuild(full, model, palette, false);
		expect([...editing.targets.values()].some((target) => target.insert)).toBe(
			false,
		);
		editing.dispose();
	});

	it("observes each gizmo once across mode changes and submits only at drag end", () => {
		const props = createTestProps();
		props.selectedElementId = TEST_STRUCTURE.elements[0]?.id ?? null;
		const terrain = createTestTerrain(scene);
		const parent = new TransformNode("world", scene);
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
			camera: new SceneCamera(scene, terrain),
			getProps: () => props,
			linkLabel() {},
			onDraft() {},
			onDragging() {},
		});
		editing.rebuild(TEST_STRUCTURE, model, palette, false);
		props.transformMode = "rotate";
		editing.rebuild(TEST_STRUCTURE, model, palette, false);
		props.transformMode = "translate";
		editing.rebuild(TEST_STRUCTURE, model, palette, false);
		const gizmo = editing.gizmo.gizmos.positionGizmo;
		const node = props.selectedElementId
			? model.elements.get(props.selectedElementId)
			: null;
		if (!gizmo || !node) throw new Error("Missing gizmo");
		const event = {
			dragPlanePoint: Vector3.Zero(),
			pointerId: 1,
			pointerInfo: null,
		};
		gizmo.onDragStartObservable.notifyObservers(event);
		node.position.x += 1;
		gizmo.onDragObservable.notifyObservers({
			...event,
			delta: Vector3.Right(),
			dragPlaneNormal: Vector3.Up(),
			dragDistance: 1,
		});
		expect(props.onStructureChange).not.toHaveBeenCalled();
		gizmo.onDragEndObservable.notifyObservers(event);
		gizmo.onDragEndObservable.notifyObservers(event);
		expect(props.onStructureChange).toHaveBeenCalledTimes(1);
		expect(editing.dragging).toBe(false);
		editing.dispose();
	});
});
