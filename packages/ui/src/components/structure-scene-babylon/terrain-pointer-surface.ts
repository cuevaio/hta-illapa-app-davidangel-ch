import { Mesh, PickingInfo, Ray, type Scene, Vector3 } from "@babylonjs/core";
import type { BabylonTerrain } from "@hack-the-andes-project/terrain/babylon/types";

export class TerrainPointerSurface extends Mesh {
	private readonly worldRay = new Ray(Vector3.Zero(), Vector3.Zero());

	constructor(
		scene: Scene,
		private readonly terrain: BabylonTerrain,
	) {
		super("terrain-pointer-surface", scene);
		this.parent = terrain.root;
		this.isPickable = true;
		this.isNearPickable = true;
	}

	override intersects(ray: Ray): PickingInfo {
		Ray.TransformToRef(ray, this.getWorldMatrix(), this.worldRay);
		this.worldRay.direction.normalize();
		const localPoint = this.terrain.pick(this.worldRay);
		const result = new PickingInfo();
		if (!localPoint) return result;
		result.hit = true;
		result.pickedMesh = this;
		result.pickedPoint = Vector3.TransformCoordinates(
			localPoint,
			this.terrain.root.getWorldMatrix(),
		);
		result.distance = Vector3.Distance(
			this.worldRay.origin,
			result.pickedPoint,
		);
		return result;
	}
}
