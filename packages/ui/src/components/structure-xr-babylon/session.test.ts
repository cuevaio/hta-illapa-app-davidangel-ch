import {
	ArcRotateCamera,
	Color4,
	FreeCamera,
	NullEngine,
	Observable,
	Quaternion,
	Scene,
	TransformNode,
	Vector3,
	WebXRSessionManager,
	WebXRState,
} from "@babylonjs/core";
import type { BabylonTerrain } from "@hack-the-andes-project/terrain/babylon/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StructureXrController } from "../../lib/structure-xr-babylon";
import { createStructureXr } from "../structure-xr-babylon";
import {
	MAQUETA_SCALE_RATIO,
	MAQUETA_SIZE_M,
	PLACEMENT_FALLBACK_DELAY_MS,
	PLACEMENT_FALLBACK_DISTANCE_M,
	PLACEMENT_FALLBACK_HEIGHT_M,
} from "./constants";

const factories = vi.hoisted(() => ({
	experience: vi.fn(),
	visuals: vi.fn(),
	emulator: vi.fn(),
}));

vi.mock("@babylonjs/core", async (importOriginal) => {
	const core = await importOriginal<typeof import("@babylonjs/core")>();
	return {
		...core,
		WebXRExperienceHelper: { CreateAsync: factories.experience },
		WebXRInput: class {
			dispose = vi.fn();
		},
	};
});

vi.mock("./visuals", () => ({ createXrVisuals: factories.visuals }));
vi.mock("./emulator", () => ({ acquireLocalEmulator: factories.emulator }));

interface SurfaceResult {
	position: Vector3;
	rotationQuaternion: Quaternion;
}

interface TestAnchor {
	attachedNode?: TransformNode;
	remove(): void;
}

let controller: StructureXrController | null = null;
let engine: NullEngine;

beforeEach(() => {
	vi.stubGlobal("navigator", {});
	vi.spyOn(WebXRSessionManager, "IsSessionSupportedAsync").mockResolvedValue(
		true,
	);
	factories.emulator.mockResolvedValue(null);
	engine = new NullEngine();
});

afterEach(async () => {
	await controller?.exit();
	controller?.dispose();
	await Promise.resolve();
	await Promise.resolve();
	engine.dispose();
	controller = null;
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

function prepareSession() {
	const scene = new Scene(engine);
	scene.useRightHandedSystem = true;
	scene.clearColor = new Color4(0.2, 0.3, 0.4, 1);
	const desktopCamera = new ArcRotateCamera(
		"desktop",
		0.4,
		1.1,
		500,
		Vector3.Zero(),
		scene,
	);
	const xrCamera = new FreeCamera("xr", new Vector3(0, 1.7, 0), scene);
	xrCamera.rotationQuaternion = Quaternion.Identity();
	const content = new TransformNode("content", scene);
	const terrain: BabylonTerrain = {
		root: new TransformNode("terrain", scene),
		update: vi.fn(),
		pick: vi.fn(() => null),
		heightAt: vi.fn(() => 2400),
		toLocal: vi.fn(() => ({ x: 0, z: 0 })),
		toGeo: vi.fn(() => ({ lat: 0, lng: 0 })),
		setClip: vi.fn(),
		setOpacity: vi.fn(),
		dispose: vi.fn(),
	};
	const visuals = {
		manager: { utilityLayer: { utilityLayerScene: scene } },
		reticle: new TransformNode("reticle", scene),
		hint: new TransformNode("hint", scene),
		panel: new TransformNode("panel", scene),
		dispose: vi.fn(),
	};
	visuals.reticle.setEnabled(false);
	visuals.hint.setEnabled(false);
	visuals.panel.setEnabled(false);
	const hitTest = {
		onHitTestResultObservable: new Observable<SurfaceResult[]>(),
		paused: false,
		dispose: vi.fn(),
	};
	const anchor: TestAnchor = { remove: vi.fn() };
	const anchors = {
		attached: true,
		addAnchorAtPositionAndRotationAsync: vi.fn(async () => anchor),
		dispose: vi.fn(),
	};
	const onStateChangedObservable = new Observable<WebXRState>();
	const activeSession = new EventTarget();
	const sessionManager = {
		inXRSession: false,
		onXRSessionInit: new Observable<EventTarget>(),
		getWebXRRenderTarget: vi.fn(() => ({ dispose: vi.fn() })),
	};
	const endSession = () => {
		sessionManager.inXRSession = false;
		scene.activeCamera = desktopCamera;
		onStateChangedObservable.notifyObservers(WebXRState.NOT_IN_XR);
	};
	const experience = {
		camera: xrCamera,
		sessionManager,
		featuresManager: {
			enableFeature: vi.fn((name: string) => {
				if (name === "xr-hit-test") return hitTest;
				if (name === "xr-anchor-system") return anchors;
				return { dispose: vi.fn() };
			}),
			dispose: vi.fn(),
		},
		onStateChangedObservable,
		enterXRAsync: vi.fn(async () => {
			sessionManager.inXRSession = true;
			sessionManager.onXRSessionInit.notifyObservers(activeSession);
			scene.activeCamera = xrCamera;
		}),
		exitXRAsync: vi.fn(async () => endSession()),
		dispose: vi.fn(),
	};
	factories.experience.mockResolvedValue(experience);
	factories.visuals.mockReturnValue(visuals);
	const options = {
		scene,
		terrain,
		content,
		getFocus: () => ({ x: 1250, z: -2300 }),
		labels: {
			placeTable: "Place table",
			undo: "Undo",
			exit: "Exit",
			error: "XR error",
		},
		onUndo: vi.fn(),
		onSupportChange: vi.fn(),
		onSessionChange: vi.fn(),
		onError: vi.fn(),
	};
	return {
		scene,
		desktopCamera,
		content,
		terrain,
		visuals,
		hitTest,
		anchor,
		anchors,
		activeSession,
		experience,
		options,
		endSession,
	};
}

describe("XR session lifecycle", () => {
	it("places the focus at the hit and restores desktop state after the runtime ends the session", async () => {
		const state = prepareSession();
		controller = await createStructureXr(state.options);
		await controller.enter();
		expect(state.experience.enterXRAsync).toHaveBeenCalledWith(
			"immersive-ar",
			"local-floor",
			expect.anything(),
		);
		expect(state.content.isEnabled()).toBe(false);
		expect(state.visuals.hint.isEnabled()).toBe(true);
		state.hitTest.onHitTestResultObservable.notifyObservers([
			{
				position: new Vector3(0.3, 0.8, -1),
				rotationQuaternion: Quaternion.Identity(),
			},
		]);
		state.activeSession.dispatchEvent(new Event("select"));
		state.scene.onBeforeRenderObservable.notifyObservers(state.scene);
		await Promise.resolve();
		state.content.computeWorldMatrix(true);
		const focusWorld = Vector3.TransformCoordinates(
			new Vector3(1250, 2400, -2300),
			state.content.getWorldMatrix(),
		);
		expect(Vector3.Distance(focusWorld, new Vector3(0.3, 0.8, -1))).toBeCloseTo(
			0,
		);
		expect(state.content.scaling.x).toBe(MAQUETA_SCALE_RATIO);
		expect(state.terrain.setClip).toHaveBeenCalledWith({
			center: { x: 1250, z: -2300 },
			sizeM: MAQUETA_SIZE_M,
		});
		expect(state.anchor.attachedNode).toBe(state.content.parent);
		expect(state.visuals.panel.isEnabled()).toBe(true);
		state.endSession();
		expect(state.content.parent).toBeNull();
		expect(state.content.position.asArray()).toEqual([0, 0, 0]);
		expect(state.content.scaling.asArray()).toEqual([1, 1, 1]);
		expect(state.scene.activeCamera).toBe(state.desktopCamera);
		expect(state.scene.clearColor.asArray()).toEqual([0.2, 0.3, 0.4, 1]);
		expect(state.visuals.panel.isEnabled()).toBe(false);
		expect(state.terrain.setClip).toHaveBeenLastCalledWith(null);
		expect(state.options.onSessionChange.mock.calls).toEqual([[true], [false]]);
		expect(state.anchor.remove).toHaveBeenCalledOnce();
	});

	it("offers a floor-relative fallback only after the surface search times out", async () => {
		let nowMs = 0;
		vi.spyOn(performance, "now").mockImplementation(() => nowMs);
		const state = prepareSession();
		controller = await createStructureXr(state.options);
		await controller.enter();
		state.scene.activeCamera?.getViewMatrix(true);
		state.scene.onBeforeRenderObservable.notifyObservers(state.scene);
		expect(state.visuals.reticle.isEnabled()).toBe(false);
		nowMs = PLACEMENT_FALLBACK_DELAY_MS;
		state.scene.onBeforeRenderObservable.notifyObservers(state.scene);
		expect(state.visuals.reticle.isEnabled()).toBe(true);
		expect(state.visuals.reticle.position.y).toBe(PLACEMENT_FALLBACK_HEIGHT_M);
		expect(state.visuals.reticle.position.z).toBeCloseTo(
			-PLACEMENT_FALLBACK_DISTANCE_M,
		);
		state.activeSession.dispatchEvent(new Event("select"));
		expect(state.visuals.reticle.isEnabled()).toBe(false);
		expect(state.visuals.panel.isEnabled()).toBe(true);
	});

	it("restores visibility and environment and reports the supplied label when entry fails", async () => {
		const state = prepareSession();
		state.experience.enterXRAsync.mockRejectedValueOnce(
			new Error("permission denied"),
		);
		controller = await createStructureXr(state.options);
		await controller.enter();
		expect(state.content.isEnabled()).toBe(true);
		expect(state.scene.clearColor.asArray()).toEqual([0.2, 0.3, 0.4, 1]);
		expect(state.options.onError).toHaveBeenCalledWith("XR error");
		expect(state.options.onSessionChange).not.toHaveBeenCalled();
	});

	it("keeps the session active and reports an error when the runtime cannot end it", async () => {
		const state = prepareSession();
		controller = await createStructureXr(state.options);
		await controller.enter();
		state.experience.exitXRAsync.mockImplementationOnce(async () => {});
		await controller.exit();
		expect(state.options.onError).toHaveBeenCalledWith("XR error");
		expect(state.options.onSessionChange.mock.calls).toEqual([[true]]);
		expect(state.scene.activeCamera).toBe(state.experience.camera);
		await controller.exit();
		expect(state.options.onSessionChange.mock.calls).toEqual([[true], [false]]);
	});
});
