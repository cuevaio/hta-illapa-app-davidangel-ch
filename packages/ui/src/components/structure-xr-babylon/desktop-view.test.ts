import {
	ArcRotateCamera,
	FreeCamera,
	NullEngine,
	Quaternion,
	Scene,
	Vector3,
} from "@babylonjs/core";
import { afterEach, describe, expect, it } from "vitest";
import { captureDesktopView } from "./desktop-view";

const engines: NullEngine[] = [];

afterEach(() => {
	for (const engine of engines) engine.dispose();
	engines.length = 0;
});

describe("desktop camera restoration", () => {
	it("restores an orbit camera pose immediately without replacing its saved home state", () => {
		const engine = new NullEngine();
		engines.push(engine);
		const scene = new Scene(engine);
		scene.useRightHandedSystem = true;
		const camera = new ArcRotateCamera(
			"desktop",
			0.4,
			1.1,
			500,
			new Vector3(12, 34, 56),
			scene,
		);
		camera.storeState();
		camera.alpha = 0.9;
		camera.getViewMatrix(true);
		const previousPosition = camera.position.clone();
		const restore = captureDesktopView(scene);
		camera.setTarget(new Vector3(7, 8, 9));
		camera.alpha = 2;
		camera.beta = 2;
		camera.radius = 10;
		camera.restoreStateInterpolationFactor = 0.5;
		camera.inertialAlphaOffset = 0.2;
		scene.activeCamera = new FreeCamera("xr", Vector3.Zero(), scene);
		restore();
		expect(scene.activeCamera).toBe(camera);
		expect(camera.alpha).toBe(0.9);
		expect(camera.beta).toBe(1.1);
		expect(camera.radius).toBe(500);
		expect(camera.target.asArray()).toEqual([12, 34, 56]);
		expect(Vector3.Distance(camera.position, previousPosition)).toBeCloseTo(0);
		expect(camera.inertialAlphaOffset).toBe(0);
		camera.restoreStateInterpolationFactor = 0;
		camera.restoreState();
		expect(camera.alpha).toBe(0.4);
	});

	it("restores a free camera's quaternion and position", () => {
		const engine = new NullEngine();
		engines.push(engine);
		const scene = new Scene(engine);
		const camera = new FreeCamera("desktop", new Vector3(12, 34, 56), scene);
		camera.rotationQuaternion = Quaternion.FromEulerAngles(0.1, 0.2, 0.3);
		const previousRotation = camera.rotationQuaternion.clone();
		const restore = captureDesktopView(scene);
		camera.position.setAll(0);
		camera.rotationQuaternion = Quaternion.Identity();
		camera.cameraDirection.setAll(1);
		restore();
		expect(camera.position.asArray()).toEqual([12, 34, 56]);
		expect(camera.rotationQuaternion?.asArray()).toEqual(
			previousRotation.asArray(),
		);
		expect(camera.cameraDirection.asArray()).toEqual([0, 0, 0]);
	});
});
