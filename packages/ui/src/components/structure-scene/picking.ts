import type { Terrain } from "@hack-the-andes-project/terrain/types";
import {
	type Camera,
	type Group,
	Ray,
	type Raycaster,
	type Vector3,
} from "three";
import type { PlacementTool } from "../../lib/structure-scene";

export class TerrainPicker {
	private ray = new Ray();
	private point: Vector3 | null = null;
	private cached = false;
	constructor(private terrain: Terrain) {}
	pick(ray: Ray): Vector3 | null {
		if (!this.cached || !this.ray.equals(ray)) {
			this.ray.copy(ray);
			this.point = this.terrain.pick(ray);
			this.cached = true;
		}
		return this.point?.clone() ?? null;
	}
	nextFrame() {
		this.cached = false;
	}
}

export function pickPlacement(
	terrain: Terrain,
	raycaster: Raycaster,
	structureRoot: Group | null,
	tool: PlacementTool | null,
	ground: Vector3 | null,
	camera: Camera,
): Vector3 | null {
	if (!tool || !("primitive" in tool) || !structureRoot) return ground;
	raycaster.camera = camera;
	const surfaces: Group["children"] = [];
	structureRoot.traverse((object) => {
		if (object.type === "Mesh") surfaces.push(object);
	});
	const structureHit = raycaster.intersectObjects(surfaces, false)[0];
	if (
		!structureHit ||
		(ground &&
			terrain.group
				.localToWorld(ground.clone())
				.distanceTo(raycaster.ray.origin) < structureHit.distance)
	)
		return ground;
	return terrain.group.worldToLocal(structureHit.point.clone());
}
