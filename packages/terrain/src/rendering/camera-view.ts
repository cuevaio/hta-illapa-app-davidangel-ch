import { ArrayCamera, type Camera, Matrix4, Vector3 } from "three";
import {
	PROJECTION_PERSPECTIVE_INDEX,
	PROJECTION_VERTICAL_SCALE_INDEX,
} from "../constants";

export class LocalCameraView {
	readonly position = new Vector3();
	readonly clipMatrix = new Matrix4();
	readonly worldToLocal = new Matrix4();
	readonly localViewMatrix = new Matrix4();
	readonly projectionMatrix = new Matrix4();
	fovYRadians = 0;
	orthographic = false;

	update(camera: Camera, groupMatrixWorld: Matrix4): void {
		const projectionCamera =
			camera instanceof ArrayCamera ? (camera.cameras[0] ?? camera) : camera;
		this.worldToLocal.copy(groupMatrixWorld).invert();
		this.position
			.setFromMatrixPosition(camera.matrixWorld)
			.applyMatrix4(this.worldToLocal);
		this.localViewMatrix.multiplyMatrices(
			camera.matrixWorldInverse,
			groupMatrixWorld,
		);
		this.projectionMatrix.copy(projectionCamera.projectionMatrix);
		this.clipMatrix.multiplyMatrices(
			this.projectionMatrix,
			this.localViewMatrix,
		);
		const projectionScale = Math.abs(
			Number(this.projectionMatrix.elements[PROJECTION_VERTICAL_SCALE_INDEX]),
		);
		this.fovYRadians = 2 * Math.atan(1 / projectionScale);
		this.orthographic =
			this.projectionMatrix.elements[PROJECTION_PERSPECTIVE_INDEX] === 1;
	}
}
