import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { SceneInsets } from "../../../lib/structure-scene";
import { frameCameraPoints } from "../camera-framing";
import {
	CAMERA_FIELD_OF_VIEW_DEG,
	CAMERA_FOCUS_MIN_DISTANCE_M,
} from "../constants";
import {
	TEST_ANCHOR_ELEVATION_M,
	TEST_FOCUS_OCCUPANCY_MAX_RATIO,
	TEST_FOCUS_OCCUPANCY_MIN_RATIO,
	TEST_VIEWPORT_HEIGHT_PX,
	TEST_VIEWPORT_WIDTH_PX,
} from "./constants";

const size = { width: TEST_VIEWPORT_WIDTH_PX, height: TEST_VIEWPORT_HEIGHT_PX };
const insets: SceneInsets = {
	topPx: 80,
	rightPx: 320,
	bottomPx: 50,
	leftPx: 240,
};
describe("camera framing in the free viewport", () => {
	for (const spanM of [129, 500, 2000]) {
		it(`fills approximately 45% for a ${spanM} metre structure`, () => {
			const camera = new PerspectiveCamera(
				CAMERA_FIELD_OF_VIEW_DEG,
				size.width / size.height,
			);
			camera.setViewOffset(
				size.width,
				size.height,
				(insets.rightPx - insets.leftPx) / 2,
				(insets.bottomPx - insets.topPx) / 2,
				size.width,
				size.height,
			);
			const points = [
				new Vector3(-spanM / 2, TEST_ANCHOR_ELEVATION_M, -5),
				new Vector3(spanM / 2, TEST_ANCHOR_ELEVATION_M, 5),
			];
			const frame = frameCameraPoints(camera, points, insets, size);
			camera.position.copy(frame.position);
			camera.lookAt(frame.target);
			camera.updateMatrixWorld(true);
			const projected = points.map((point) => point.clone().project(camera));
			const occupancy = Math.max(
				((Math.max(...projected.map((point) => point.x)) -
					Math.min(...projected.map((point) => point.x))) *
					size.width) /
					2 /
					(size.width - insets.leftPx - insets.rightPx),
				((Math.max(...projected.map((point) => point.y)) -
					Math.min(...projected.map((point) => point.y))) *
					size.height) /
					2 /
					(size.height - insets.topPx - insets.bottomPx),
			);
			expect(occupancy).toBeGreaterThanOrEqual(TEST_FOCUS_OCCUPANCY_MIN_RATIO);
			expect(occupancy).toBeLessThanOrEqual(TEST_FOCUS_OCCUPANCY_MAX_RATIO);
			expect(frame.position.distanceTo(frame.target)).toBeGreaterThanOrEqual(
				CAMERA_FOCUS_MIN_DISTANCE_M,
			);
			const center = frame.target.clone().project(camera);
			expect(((center.x + 1) * size.width) / 2).toBeCloseTo(
				(insets.leftPx + size.width - insets.rightPx) / 2,
			);
			expect(((1 - center.y) * size.height) / 2).toBeCloseTo(
				(insets.topPx + size.height - insets.bottomPx) / 2,
			);
		});
	}
	it("keeps a useful distance for a point-sized target", () => {
		const camera = new PerspectiveCamera(
			CAMERA_FIELD_OF_VIEW_DEG,
			size.width / size.height,
		);
		const frame = frameCameraPoints(camera, [new Vector3()], insets, size);
		expect(frame.position.distanceTo(frame.target)).toBeGreaterThanOrEqual(
			CAMERA_FOCUS_MIN_DISTANCE_M,
		);
	});
});
