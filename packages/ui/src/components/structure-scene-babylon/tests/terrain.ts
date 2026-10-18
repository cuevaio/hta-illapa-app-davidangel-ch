import { type Scene, TransformNode } from "@babylonjs/core";
import type { BabylonTerrain } from "@hack-the-andes-project/terrain/babylon/types";
import {
	createLocalFrame,
	localToLonLat,
	lonLatToLocal,
} from "@hack-the-andes-project/terrain/domain/local-frame";
import type { LocalPoint } from "@hack-the-andes-project/terrain/types";
import { TEST_GROUND_M, TEST_STRUCTURE } from "./constants";

export function createTestTerrain(
	scene: Scene,
	sample: (point: LocalPoint) => number | null = () => TEST_GROUND_M,
): BabylonTerrain {
	const root = new TransformNode("test-terrain", scene);
	const frame = createLocalFrame(
		TEST_STRUCTURE.anchor.lng,
		TEST_STRUCTURE.anchor.lat,
	);
	return {
		root,
		update() {},
		pick() {
			return null;
		},
		heightAt: sample,
		toLocal(point) {
			return lonLatToLocal(frame, point.lng, point.lat);
		},
		toGeo(point) {
			const geographic = localToLonLat(frame, point.x, point.z);
			return { lng: geographic.lon, lat: geographic.lat };
		},
		setClip() {},
		setOpacity() {},
		dispose() {
			root.dispose();
		},
	};
}
