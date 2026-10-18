import { type Scene, TransformNode } from "@babylonjs/core";
import {
	TEST_EARTH_RADIUS_M,
	TEST_GROUND_M,
	TEST_STRUCTURE,
} from "./constants";

const RADIANS_PER_DEGREE = Math.PI / 180;
const mercatorY = (lat: number) =>
	Math.log(Math.tan(Math.PI / 4 + (lat * RADIANS_PER_DEGREE) / 2));

import type {
	LocalPoint,
	StructureTerrain,
} from "../../../lib/structure-terrain";

export function createTestTerrain(
	scene: Scene,
	sample: (point: LocalPoint) => number | null = () => TEST_GROUND_M,
): StructureTerrain {
	const root = new TransformNode("test-terrain", scene);
	const { lat: originLat, lng: originLng } = TEST_STRUCTURE.anchor;
	const metresPerRadian =
		TEST_EARTH_RADIUS_M * Math.cos(originLat * RADIANS_PER_DEGREE);
	return {
		root,
		update() {},
		pick() {
			return null;
		},
		heightAt: sample,
		toLocal(point) {
			return {
				x: (point.lng - originLng) * RADIANS_PER_DEGREE * metresPerRadian,
				z: -(mercatorY(point.lat) - mercatorY(originLat)) * metresPerRadian,
			};
		},
		toGeo(point) {
			const latitudeRadians =
				2 *
					Math.atan(
						Math.exp(mercatorY(originLat) - point.z / metresPerRadian),
					) -
				Math.PI / 2;
			return {
				lat: latitudeRadians / RADIANS_PER_DEGREE,
				lng: originLng + point.x / metresPerRadian / RADIANS_PER_DEGREE,
			};
		},
		setClip() {},
		setOpacity() {},
		dispose() {
			root.dispose();
		},
	};
}
