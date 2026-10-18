import {
	ArcRotateCamera,
	type Camera,
	type Scene,
	TargetCamera,
} from "@babylonjs/core";

export function captureDesktopView(scene: Scene): () => void {
	const camera: Camera | null = scene.activeCamera;
	if (!camera)
		return () => {
			scene.activeCamera = null;
		};
	const position = camera.position.clone();
	const upVector = camera.upVector.clone();
	const rotation =
		camera instanceof TargetCamera ? camera.rotation.clone() : null;
	const rotationQuaternion =
		camera instanceof TargetCamera ? camera.rotationQuaternion?.clone() : null;
	const orbit =
		camera instanceof ArcRotateCamera
			? {
					alpha: camera.alpha,
					beta: camera.beta,
					radius: camera.radius,
					target: camera.target.clone(),
					targetScreenOffset: camera.targetScreenOffset.clone(),
				}
			: null;
	return () => {
		if (camera.isDisposed()) return;
		scene.activeCamera = camera;
		camera.upVector.copyFrom(upVector);
		if (camera instanceof ArcRotateCamera && orbit) {
			camera.stopInterpolation();
			camera.setTarget(orbit.target);
			camera.alpha = orbit.alpha;
			camera.beta = orbit.beta;
			camera.radius = orbit.radius;
			camera.targetScreenOffset.copyFrom(orbit.targetScreenOffset);
			camera.inertialAlphaOffset = 0;
			camera.inertialBetaOffset = 0;
			camera.inertialRadiusOffset = 0;
			camera.inertialPanningX = 0;
			camera.inertialPanningY = 0;
		}
		if (camera instanceof TargetCamera && rotation) {
			camera.rotation.copyFrom(rotation);
			camera.rotationQuaternion = rotationQuaternion?.clone() ?? null;
			camera.cameraDirection.setAll(0);
			camera.cameraRotation.setAll(0);
		}
		camera.position.copyFrom(position);
		camera.getViewMatrix(true);
	};
}
