import type { RootState } from "@react-three/fiber";
import { type Camera, Vector3 } from "three";

export interface DesktopViewSnapshot {
	camera: RootState["camera"];
	cameraSnapshot: Camera;
	controls: RootState["controls"];
	controlsTarget: Vector3 | null;
	controlsEnabled: boolean | null;
}

export function restoreDesktopView(
	snapshot: DesktopViewSnapshot,
	controls: RootState["controls"] = snapshot.controls,
) {
	if (controls) {
		if (
			snapshot.controlsTarget &&
			"target" in controls &&
			controls.target instanceof Vector3
		) {
			controls.target.copy(snapshot.controlsTarget);
		}
		if (snapshot.controlsEnabled !== null && "enabled" in controls) {
			controls.enabled = snapshot.controlsEnabled;
		}
		if ("update" in controls && typeof controls.update === "function") {
			const damping =
				"enableDamping" in controls ? controls.enableDamping : undefined;
			if ("enableDamping" in controls) controls.enableDamping = false;
			controls.update();
			if ("enableDamping" in controls) controls.enableDamping = damping;
		}
	}
	const desktopCamera: Camera = snapshot.camera;
	desktopCamera.copy(snapshot.cameraSnapshot, false);
	desktopCamera.updateMatrixWorld(true);
}
