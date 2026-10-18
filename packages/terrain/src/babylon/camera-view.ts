import { type Camera, Frustum, Matrix, Vector3 } from "@babylonjs/core";
import {
	PROJECTION_PERSPECTIVE_INDEX,
	PROJECTION_VERTICAL_SCALE_INDEX,
} from "../constants";
import type { FrustumLike, Vec3 } from "../domain/types";

export class LocalCameraView implements FrustumLike {
	readonly position = new Vector3();
	readonly clipMatrix = Matrix.Identity();
	readonly worldToLocal = Matrix.Identity();
	private readonly localViewMatrix = Matrix.Identity();
	private readonly planes = Frustum.GetPlanes(Matrix.Identity());
	fovYRadians = 0;
	orthographic = false;

	update(camera: Camera, rootWorldMatrix: Matrix): void {
		const viewMatrix = camera.getViewMatrix();
		const projectionCamera = camera.rigCameras[0] ?? camera;
		const projection = projectionCamera.getProjectionMatrix();
		rootWorldMatrix.invertToRef(this.worldToLocal);
		Vector3.TransformCoordinatesToRef(
			camera.globalPosition,
			this.worldToLocal,
			this.position,
		);
		rootWorldMatrix.multiplyToRef(viewMatrix, this.localViewMatrix);
		this.localViewMatrix.multiplyToRef(projection, this.clipMatrix);
		const projectionScale = Math.abs(
			Number(projection.m[PROJECTION_VERTICAL_SCALE_INDEX]),
		);
		this.fovYRadians = 2 * Math.atan(1 / projectionScale);
		this.orthographic = projection.m[PROJECTION_PERSPECTIVE_INDEX] === 1;
		Frustum.GetPlanesToRef(this.clipMatrix, this.planes);
	}

	intersectsBox(minimum: Vec3, maximum: Vec3): boolean {
		for (const plane of this.planes) {
			const normal = plane.normal;
			if (
				normal.x * (normal.x >= 0 ? maximum.x : minimum.x) +
					normal.y * (normal.y >= 0 ? maximum.y : minimum.y) +
					normal.z * (normal.z >= 0 ? maximum.z : minimum.z) +
					plane.d <
				0
			)
				return false;
		}
		return true;
	}
}
