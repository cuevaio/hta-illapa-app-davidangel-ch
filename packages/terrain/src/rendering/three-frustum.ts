import { Box3, Frustum, type Matrix4 } from "three";
import type { FrustumLike, Vec3 } from "../domain/types";

export class ThreeFrustum implements FrustumLike {
	private readonly frustum = new Frustum();
	private readonly box = new Box3();

	update(localClipMatrix: Matrix4): void {
		this.frustum.setFromProjectionMatrix(localClipMatrix);
	}

	intersectsBox(min: Vec3, max: Vec3): boolean {
		this.box.min.set(min.x, min.y, min.z);
		this.box.max.set(max.x, max.y, max.z);
		return this.frustum.intersectsBox(this.box);
	}
}
