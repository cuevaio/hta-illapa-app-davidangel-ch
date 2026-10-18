import { PE22_TERRAIN_ORIGIN } from "@hack-the-andes-project/business/structures/landmarks";
import type { Terrain } from "@hack-the-andes-project/terrain/types";
import { Group, Plane, Vector3 } from "three";
import { TEST_ANCHOR_ELEVATION_M, TEST_METRES_PER_DEG } from "./constants";

export function testTerrain(overrides: Partial<Terrain> = {}): Terrain {
	const plane = new Plane(new Vector3(0, 1, 0), -TEST_ANCHOR_ELEVATION_M);
	return {
		group: new Group(),
		update: () => {},
		dispose: () => {},
		setClip: () => {},
		setOpacity: () => {},
		heightAt: () => TEST_ANCHOR_ELEVATION_M,
		pick: (ray) => ray.intersectPlane(plane, new Vector3()),
		toLocal: ({ lat, lng }) => ({
			x: (lng - PE22_TERRAIN_ORIGIN.lng) * TEST_METRES_PER_DEG,
			z: -(lat - PE22_TERRAIN_ORIGIN.lat) * TEST_METRES_PER_DEG,
		}),
		toGeo: ({ x, z }) => ({
			lat: PE22_TERRAIN_ORIGIN.lat - z / TEST_METRES_PER_DEG,
			lng: PE22_TERRAIN_ORIGIN.lng + x / TEST_METRES_PER_DEG,
		}),
		...overrides,
	};
}
