import {
	ArrayCamera,
	Group,
	OrthographicCamera,
	PerspectiveCamera,
	Vector3,
} from "three";
import { describe, expect, it } from "vitest";
import { createLocalFrame } from "../domain/local-frame";
import { selectTiles } from "../domain/lod";
import { tileKey } from "../domain/tile-math";
import { LocalCameraView } from "./camera-view";
import { ThreeFrustum } from "./three-frustum";

function selection(view: LocalCameraView) {
	const frustum = new ThreeFrustum();
	frustum.update(view.clipMatrix);
	return selectTiles({
		cameraPosition: view.position,
		frustum,
		viewportHeightPx: 1000,
		fovYRadians: view.fovYRadians,
		orthographic: view.orthographic,
		frame: createLocalFrame(-75, -9.5),
		rootZoom: 0,
		maxZoom: 15,
		bounds: { west: -81.4, south: -18.4, east: -68.6, north: 0 },
		maxScreenSpaceError: 4,
		segments: 64,
		heightRange: { min: -100, max: 7000 },
		isReady: () => true,
		maxTiles: 300,
	});
}

describe("group-local camera view", () => {
	it("preserves LOD and frustum selection under a translated, rotated 1:1000 parent", () => {
		const camera = new PerspectiveCamera(50, 1, 1, 100_000);
		camera.position.set(1000, 12_000, 9000);
		camera.lookAt(0, 1000, 0);
		camera.updateMatrixWorld();
		const group = new Group();
		group.updateMatrixWorld();
		const normalView = new LocalCameraView();
		normalView.update(camera, group.matrixWorld);
		const originalSelection = selection(normalView);
		expect(originalSelection.display.length).toBeGreaterThan(0);

		const parent = new Group();
		parent.position.set(2, 1, -3);
		parent.rotation.set(0.1, 0.8, -0.2);
		parent.scale.setScalar(1 / 1000);
		camera.near /= 1000;
		camera.far /= 1000;
		camera.updateProjectionMatrix();
		parent.add(group, camera);
		parent.updateMatrixWorld(true);
		const tabletopView = new LocalCameraView();
		tabletopView.update(camera, group.matrixWorld);
		expect(tabletopView.position.distanceTo(normalView.position)).toBeLessThan(
			1e-8,
		);
		expect(selection(tabletopView).display.map(tileKey)).toEqual(
			originalSelection.display.map(tileKey),
		);
		const localPoint = new Vector3(0, 1000, 0);
		const clipBefore = localPoint.clone().applyMatrix4(normalView.clipMatrix);
		const clipAfter = localPoint.clone().applyMatrix4(tabletopView.clipMatrix);
		expect(clipAfter.distanceTo(clipBefore)).toBeLessThan(1e-9);
	});

	it("uses an XR array's world position and first eye's projection", () => {
		const eye = new PerspectiveCamera(70, 1, 0.01, 100);
		const camera = new ArrayCamera([eye]);
		camera.position.set(2, 3, 4);
		const parent = new Group();
		parent.position.set(-1, 1, 2);
		parent.scale.setScalar(1 / 1000);
		parent.add(camera);
		parent.updateMatrixWorld(true);
		const group = new Group();
		parent.add(group);
		parent.updateMatrixWorld(true);
		const view = new LocalCameraView();
		view.update(camera, group.matrixWorld);
		expect(view.position.distanceTo(camera.position)).toBeLessThan(1e-9);
		expect(view.projectionMatrix.equals(eye.projectionMatrix)).toBe(true);
		expect(view.fovYRadians).toBeCloseTo((70 * Math.PI) / 180);
	});

	it("handles orthographic projection", () => {
		const camera = new OrthographicCamera(-100, 100, 100, -100, 1, 100_000);
		camera.position.set(0, 10_000, 0);
		camera.lookAt(0, 0, 0);
		camera.updateMatrixWorld();
		const group = new Group();
		group.updateMatrixWorld();
		const view = new LocalCameraView();
		view.update(camera, group.matrixWorld);
		expect(view.orthographic).toBe(true);
		expect(Math.tan(view.fovYRadians / 2)).toBeCloseTo(100);
	});
});
