import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/jetbrains-mono";

import {
	BLACK_HEX_COLOR,
	BRAND_TEAL_COLOR,
	CAMERA_ARRIVAL_THRESHOLD_M,
	CAMERA_FAR_M,
	CAMERA_FOV_DEG,
	CAMERA_LERP_FACTOR,
	CAMERA_NEAR_M,
	CARRIER_KEYS_ORDER,
	CARRIER_PROFILES,
	FILL_LIGHT_COLOR_HEX,
	FILL_LIGHT_INTENSITY,
	FILL_LIGHT_X_M,
	FILL_LIGHT_Y_M,
	FILL_LIGHT_Z_M,
	HAZARD_EMISSIVE_HIGHLIGHT_INTENSITY,
	HEMISPHERE_GROUND_COLOR_HEX,
	HEMISPHERE_LIGHT_INTENSITY,
	HEMISPHERE_SKY_COLOR_HEX,
	HIGH_ORANGE_COLOR,
	INITIAL_CAMERA_X_M,
	INITIAL_CAMERA_Y_M,
	INITIAL_CAMERA_Z_M,
	INITIAL_TARGET_X_M,
	INITIAL_TARGET_Y_M,
	INITIAL_TARGET_Z_M,
	MAX_DEVICE_PIXEL_RATIO,
	OFFSCREEN_POINTER_COORD,
	ORBIT_DAMPING_FACTOR,
	ORBIT_MAX_DISTANCE_M,
	ORBIT_MAX_POLAR_ANGLE_FACTOR,
	ORBIT_MIN_DISTANCE_M,
	ORBIT_MIN_POLAR_ANGLE_RAD,
	POINTER_CLICK_DRAG_THRESHOLD_PX,
	POINTER_RAY_LENGTH_M,
	PRESET_CHOSICA_POS_X_M,
	PRESET_CHOSICA_POS_Y_M,
	PRESET_CHOSICA_POS_Z_M,
	PRESET_CHOSICA_TARGET_X_M,
	PRESET_CHOSICA_TARGET_Y_M,
	PRESET_CHOSICA_TARGET_Z_M,
	PRESET_DETOUR_POS_X_M,
	PRESET_DETOUR_POS_Y_M,
	PRESET_DETOUR_POS_Z_M,
	PRESET_DETOUR_TARGET_X_M,
	PRESET_DETOUR_TARGET_Y_M,
	PRESET_DETOUR_TARGET_Z_M,
	PRESET_HAZARD_POS_X_M,
	PRESET_HAZARD_POS_Y_M,
	PRESET_HAZARD_POS_Z_M,
	PRESET_HAZARD_TARGET_X_M,
	PRESET_HAZARD_TARGET_Y_M,
	PRESET_HAZARD_TARGET_Z_M,
	PRESET_TICLIO_POS_X_M,
	PRESET_TICLIO_POS_Y_M,
	PRESET_TICLIO_POS_Z_M,
	PRESET_TICLIO_TARGET_X_M,
	PRESET_TICLIO_TARGET_Y_M,
	PRESET_TICLIO_TARGET_Z_M,
	SUN_LIGHT_COLOR_HEX,
	SUN_LIGHT_INTENSITY,
	SUN_LIGHT_X_M,
	SUN_LIGHT_Y_M,
	SUN_LIGHT_Z_M,
	TONE_MAPPING_EXPOSURE,
	XR_RECENTER_DISTANCE_M,
	XR_TABLE_OFFSET_X_M,
	XR_TABLE_OFFSET_Y_M,
	XR_TABLE_OFFSET_Z_M,
} from "@hack-the-andes-project/ui/lib/route-review-3d/constants";
import { loadRouteCorridors } from "@hack-the-andes-project/ui/lib/route-review-3d/route";
import { buildSceneElements } from "@hack-the-andes-project/ui/lib/route-review-3d/scene";
import type { CameraPreset } from "@hack-the-andes-project/ui/lib/route-review-3d/types";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ARButton } from "three/addons/webxr/ARButton.js";

const rawCanvasElement = document.getElementById("webgl-canvas");
const canvasElement =
	rawCanvasElement instanceof HTMLCanvasElement ? rawCanvasElement : undefined;
const rawXrToggleButton = document.getElementById("xr-toggle-btn");
const xrToggleButton =
	rawXrToggleButton instanceof HTMLButtonElement ? rawXrToggleButton : null;
const xrSupportNotice = document.getElementById("xr-support-notice");
const presetButtons = document.querySelectorAll<HTMLElement>(".preset-btn");
const signalBadges = document.querySelectorAll<HTMLElement>(".signal-badge");
const carrierChips = document.querySelectorAll<HTMLElement>(".carrier-chip");
const carrierEligibilityText = document.getElementById(
	"carrier-eligibility-text",
);
const elevationProfileCard = document.getElementById("elevation-profile-card");

const reducedMotionQuery = window.matchMedia(
	"(prefers-reduced-motion: reduce)",
);
let isReducedMotionPreferred = reducedMotionQuery.matches;
reducedMotionQuery.addEventListener("change", (mediaEvent) => {
	isReducedMotionPreferred = mediaEvent.matches;
});

const renderer = new THREE.WebGLRenderer({
	canvas: canvasElement,
	antialias: true,
	alpha: true,
	powerPreference: "high-performance",
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(
	Math.min(window.devicePixelRatio, MAX_DEVICE_PIXEL_RATIO),
);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
renderer.setClearColor(0x000000, 0);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local");

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
	CAMERA_FOV_DEG,
	window.innerWidth / window.innerHeight,
	CAMERA_NEAR_M,
	CAMERA_FAR_M,
);
camera.position.set(INITIAL_CAMERA_X_M, INITIAL_CAMERA_Y_M, INITIAL_CAMERA_Z_M);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(INITIAL_TARGET_X_M, INITIAL_TARGET_Y_M, INITIAL_TARGET_Z_M);
controls.enableDamping = true;
controls.dampingFactor = ORBIT_DAMPING_FACTOR;
controls.maxPolarAngle = Math.PI * ORBIT_MAX_POLAR_ANGLE_FACTOR;
controls.minPolarAngle = ORBIT_MIN_POLAR_ANGLE_RAD;
controls.minDistance = ORBIT_MIN_DISTANCE_M;
controls.maxDistance = ORBIT_MAX_DISTANCE_M;
controls.update();

const hemisphereLight = new THREE.HemisphereLight(
	HEMISPHERE_SKY_COLOR_HEX,
	HEMISPHERE_GROUND_COLOR_HEX,
	HEMISPHERE_LIGHT_INTENSITY,
);
scene.add(hemisphereLight);

const sunLight = new THREE.DirectionalLight(
	SUN_LIGHT_COLOR_HEX,
	SUN_LIGHT_INTENSITY,
);
sunLight.position.set(SUN_LIGHT_X_M, SUN_LIGHT_Y_M, SUN_LIGHT_Z_M);
scene.add(sunLight);

const fillLight = new THREE.DirectionalLight(
	FILL_LIGHT_COLOR_HEX,
	FILL_LIGHT_INTENSITY,
);
fillLight.position.set(FILL_LIGHT_X_M, FILL_LIGHT_Y_M, FILL_LIGHT_Z_M);
scene.add(fillLight);

const corridors = loadRouteCorridors();
const { rootGroup, hazardMesh, floatingCard, updateAnimations } =
	buildSceneElements(corridors);
scene.add(rootGroup);

const CAMERA_PRESETS: Record<string, CameraPreset> = {
	overview: {
		position: new THREE.Vector3(
			INITIAL_CAMERA_X_M,
			INITIAL_CAMERA_Y_M,
			INITIAL_CAMERA_Z_M,
		),
		target: new THREE.Vector3(
			INITIAL_TARGET_X_M,
			INITIAL_TARGET_Y_M,
			INITIAL_TARGET_Z_M,
		),
	},
	hazard: {
		position: new THREE.Vector3(
			PRESET_HAZARD_POS_X_M,
			PRESET_HAZARD_POS_Y_M,
			PRESET_HAZARD_POS_Z_M,
		),
		target: new THREE.Vector3(
			PRESET_HAZARD_TARGET_X_M,
			PRESET_HAZARD_TARGET_Y_M,
			PRESET_HAZARD_TARGET_Z_M,
		),
	},
	chosica: {
		position: new THREE.Vector3(
			PRESET_CHOSICA_POS_X_M,
			PRESET_CHOSICA_POS_Y_M,
			PRESET_CHOSICA_POS_Z_M,
		),
		target: new THREE.Vector3(
			PRESET_CHOSICA_TARGET_X_M,
			PRESET_CHOSICA_TARGET_Y_M,
			PRESET_CHOSICA_TARGET_Z_M,
		),
	},
	ticlio: {
		position: new THREE.Vector3(
			PRESET_TICLIO_POS_X_M,
			PRESET_TICLIO_POS_Y_M,
			PRESET_TICLIO_POS_Z_M,
		),
		target: new THREE.Vector3(
			PRESET_TICLIO_TARGET_X_M,
			PRESET_TICLIO_TARGET_Y_M,
			PRESET_TICLIO_TARGET_Z_M,
		),
	},
	detour: {
		position: new THREE.Vector3(
			PRESET_DETOUR_POS_X_M,
			PRESET_DETOUR_POS_Y_M,
			PRESET_DETOUR_POS_Z_M,
		),
		target: new THREE.Vector3(
			PRESET_DETOUR_TARGET_X_M,
			PRESET_DETOUR_TARGET_Y_M,
			PRESET_DETOUR_TARGET_Z_M,
		),
	},
};

let activePresetAnimation: CameraPreset | null = null;
let isHazardPinnedBySelection = false;
let activeCarrierIndex = 0;

function setHazardVisualHighlight(isHighlighted: boolean): void {
	const effectiveHighlight = isHighlighted || isHazardPinnedBySelection;
	floatingCard.setHighlight(effectiveHighlight);
	hazardMesh.material.emissive.set(
		effectiveHighlight ? HIGH_ORANGE_COLOR : BLACK_HEX_COLOR,
	);
	hazardMesh.material.emissiveIntensity = effectiveHighlight
		? HAZARD_EMISSIVE_HIGHLIGHT_INTENSITY
		: 0.0;
}

function selectCarrierProfile(carrierKey: string): void {
	const profileDescription = CARRIER_PROFILES[carrierKey];
	if (!profileDescription) return;

	const foundIndex = CARRIER_KEYS_ORDER.indexOf(
		carrierKey === "volvo"
			? "volvo"
			: carrierKey === "hino"
				? "hino"
				: "scania",
	);
	if (foundIndex !== -1) {
		activeCarrierIndex = foundIndex;
	}

	carrierChips.forEach((chipElement) => {
		chipElement.classList.toggle(
			"active",
			chipElement.dataset.carrier === carrierKey,
		);
	});
	if (carrierEligibilityText) {
		carrierEligibilityText.textContent = profileDescription;
	}
}

function activateCameraPreset(presetKey: string | undefined): void {
	if (!presetKey) return;
	const preset = CAMERA_PRESETS[presetKey];
	if (!preset) return;
	if (isReducedMotionPreferred) {
		camera.position.copy(preset.position);
		controls.target.copy(preset.target);
		controls.update();
		activePresetAnimation = null;
	} else {
		activePresetAnimation = {
			position: preset.position.clone(),
			target: preset.target.clone(),
		};
	}
	presetButtons.forEach((buttonElement) => {
		buttonElement.classList.toggle(
			"active",
			buttonElement.dataset.view === presetKey,
		);
	});
	isHazardPinnedBySelection = presetKey === "hazard";
	setHazardVisualHighlight(presetKey === "hazard");
}

presetButtons.forEach((buttonElement) => {
	buttonElement.addEventListener("click", () => {
		activateCameraPreset(buttonElement.dataset.view);
	});
});

signalBadges.forEach((badgeElement) => {
	badgeElement.addEventListener("click", () => {
		activateCameraPreset(badgeElement.dataset.view);
	});
});

carrierChips.forEach((chipElement) => {
	chipElement.addEventListener("click", () => {
		const carrierKey = chipElement.dataset.carrier;
		if (carrierKey) {
			selectCarrierProfile(carrierKey);
		}
	});
});

if (elevationProfileCard) {
	elevationProfileCard.addEventListener("click", () => {
		activateCameraPreset("hazard");
	});
}

controls.addEventListener("start", () => {
	activePresetAnimation = null;
});

const xrControllerPrimary = renderer.xr.getController(0);
const xrControllerSecondary = renderer.xr.getController(1);

const rayGeometry = new THREE.BufferGeometry().setFromPoints([
	new THREE.Vector3(0, 0, 0),
	new THREE.Vector3(0, 0, -POINTER_RAY_LENGTH_M),
]);
const rayMaterial = new THREE.LineBasicMaterial({
	color: new THREE.Color(BRAND_TEAL_COLOR),
});

const laserPointerPrimary = new THREE.Line(rayGeometry, rayMaterial);
xrControllerPrimary.add(laserPointerPrimary);
scene.add(xrControllerPrimary);

const laserPointerSecondary = new THREE.Line(rayGeometry, rayMaterial);
xrControllerSecondary.add(laserPointerSecondary);
scene.add(xrControllerSecondary);

const desktopRaycaster = new THREE.Raycaster();
const mouseNormalizedPosition = new THREE.Vector2(
	OFFSCREEN_POINTER_COORD,
	OFFSCREEN_POINTER_COORD,
);
const pointerDownScreenPosition = new THREE.Vector2();
const interactiveHazardObjects: THREE.Object3D[] = [
	hazardMesh,
	floatingCard.cardMesh,
	floatingCard.targetRing,
];

window.addEventListener("pointerdown", (pointerEvent) => {
	pointerDownScreenPosition.set(pointerEvent.clientX, pointerEvent.clientY);
});

window.addEventListener("pointermove", (pointerEvent) => {
	mouseNormalizedPosition.x =
		(pointerEvent.clientX / window.innerWidth) * 2 - 1;
	mouseNormalizedPosition.y =
		-(pointerEvent.clientY / window.innerHeight) * 2 + 1;

	if (!renderer.xr.isPresenting) {
		desktopRaycaster.setFromCamera(mouseNormalizedPosition, camera);
		const intersections = desktopRaycaster.intersectObjects(
			interactiveHazardObjects,
			false,
		);
		const isHoveringHazard = intersections.length > 0;
		setHazardVisualHighlight(isHoveringHazard);
		if (canvasElement) {
			canvasElement.style.cursor = isHoveringHazard ? "pointer" : "grab";
		}
	}
});

window.addEventListener("pointerup", (pointerEvent) => {
	if (renderer.xr.isPresenting) return;
	if (pointerEvent.target !== canvasElement) return;

	const dragDistancePx = Math.hypot(
		pointerEvent.clientX - pointerDownScreenPosition.x,
		pointerEvent.clientY - pointerDownScreenPosition.y,
	);
	if (dragDistancePx > POINTER_CLICK_DRAG_THRESHOLD_PX) return;

	mouseNormalizedPosition.x =
		(pointerEvent.clientX / window.innerWidth) * 2 - 1;
	mouseNormalizedPosition.y =
		-(pointerEvent.clientY / window.innerHeight) * 2 + 1;
	desktopRaycaster.setFromCamera(mouseNormalizedPosition, camera);
	const intersections = desktopRaycaster.intersectObjects(
		interactiveHazardObjects,
		false,
	);
	if (intersections.length > 0) {
		activateCameraPreset("hazard");
	}
});

const xrRaycaster = new THREE.Raycaster();
const controllerOrientationMatrix = new THREE.Matrix4();
const cameraWorldPosition = new THREE.Vector3();
const cameraForwardDirection = new THREE.Vector3();

function isControllerPointingAtHazard(controller: THREE.Object3D): boolean {
	controllerOrientationMatrix
		.identity()
		.extractRotation(controller.matrixWorld);
	xrRaycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
	xrRaycaster.ray.direction
		.set(0, 0, -1)
		.applyMatrix4(controllerOrientationMatrix);

	const intersections = xrRaycaster.intersectObjects(
		interactiveHazardObjects,
		false,
	);
	return intersections.length > 0;
}

function handleXrControllerSelect(controller: THREE.Object3D): void {
	if (!renderer.xr.isPresenting) return;
	if (isControllerPointingAtHazard(controller)) {
		isHazardPinnedBySelection = !isHazardPinnedBySelection;
		setHazardVisualHighlight(true);
	} else {
		const nextIndex = (activeCarrierIndex + 1) % CARRIER_KEYS_ORDER.length;
		const nextCarrierKey = CARRIER_KEYS_ORDER[nextIndex];
		if (nextCarrierKey) {
			selectCarrierProfile(nextCarrierKey);
		}
	}
}

function recenterTableToXrViewer(): void {
	if (!renderer.xr.isPresenting) return;
	const xrCamera = renderer.xr.getCamera();
	xrCamera.getWorldPosition(cameraWorldPosition);
	xrCamera.getWorldDirection(cameraForwardDirection);
	cameraForwardDirection.y = 0;
	if (cameraForwardDirection.lengthSq() > 0) {
		cameraForwardDirection.normalize();
	} else {
		cameraForwardDirection.set(0, 0, -1);
	}

	rootGroup.position.set(
		cameraWorldPosition.x + cameraForwardDirection.x * XR_RECENTER_DISTANCE_M,
		cameraWorldPosition.y + XR_TABLE_OFFSET_Y_M,
		cameraWorldPosition.z + cameraForwardDirection.z * XR_RECENTER_DISTANCE_M,
	);
	rootGroup.rotation.set(
		0,
		Math.atan2(-cameraForwardDirection.x, -cameraForwardDirection.z),
		0,
	);
}

[xrControllerPrimary, xrControllerSecondary].forEach((controller) => {
	controller.addEventListener("select", () => {
		handleXrControllerSelect(controller);
	});
	controller.addEventListener("squeeze", () => {
		recenterTableToXrViewer();
	});
});

const threeArButtonElement = ARButton.createButton(renderer, {
	requiredFeatures: ["local"],
});
threeArButtonElement.style.display = "none";
document.body.appendChild(threeArButtonElement);

if (navigator.xr) {
	navigator.xr
		.isSessionSupported("immersive-ar")
		.then((isSupported) => {
			if (!xrToggleButton || !xrSupportNotice) return;
			if (isSupported) {
				xrToggleButton.disabled = false;
				xrToggleButton.textContent = "Ver en la mesa";
				xrSupportNotice.textContent =
					"Meta Quest detectado. Pulsa para proyectar la maqueta en tu mesa.";
			} else {
				xrToggleButton.disabled = true;
				xrSupportNotice.textContent =
					"En este navegador se ve la maqueta. En el Quest, colócala en la mesa.";
			}
		})
		.catch(() => {
			if (!xrToggleButton || !xrSupportNotice) return;
			xrToggleButton.disabled = true;
			xrSupportNotice.textContent =
				"En este navegador se ve la maqueta. En el Quest, colócala en la mesa.";
		});
} else if (xrToggleButton && xrSupportNotice) {
	xrToggleButton.disabled = true;
	xrSupportNotice.textContent =
		"En este navegador se ve la maqueta. En el Quest, colócala en la mesa.";
}

if (xrToggleButton) {
	xrToggleButton.addEventListener("click", () => {
		threeArButtonElement.click();
	});
}

renderer.xr.addEventListener("sessionstart", () => {
	activePresetAnimation = null;
	rootGroup.position.set(
		XR_TABLE_OFFSET_X_M,
		XR_TABLE_OFFSET_Y_M,
		XR_TABLE_OFFSET_Z_M,
	);
	rootGroup.rotation.set(0, 0, 0);
	if (xrToggleButton) {
		xrToggleButton.textContent = "Salir de la mesa";
	}
});

renderer.xr.addEventListener("sessionend", () => {
	rootGroup.position.set(0, 0, 0);
	rootGroup.rotation.set(0, 0, 0);
	if (xrToggleButton) {
		xrToggleButton.textContent = "Ver en la mesa";
	}
});

window.addEventListener("resize", () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setPixelRatio(
		Math.min(window.devicePixelRatio, MAX_DEVICE_PIXEL_RATIO),
	);
});

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
	const deltaSeconds = clock.getDelta();
	const elapsedSeconds = clock.getElapsedTime();

	updateAnimations(deltaSeconds, elapsedSeconds, isReducedMotionPreferred);

	const activeCamera = renderer.xr.isPresenting
		? renderer.xr.getCamera()
		: camera;
	activeCamera.getWorldPosition(cameraWorldPosition);
	floatingCard.faceCamera(cameraWorldPosition);

	if (renderer.xr.isPresenting) {
		const isPointedByController =
			isControllerPointingAtHazard(xrControllerPrimary) ||
			isControllerPointingAtHazard(xrControllerSecondary);

		setHazardVisualHighlight(isPointedByController);
	} else {
		if (activePresetAnimation) {
			camera.position.lerp(activePresetAnimation.position, CAMERA_LERP_FACTOR);
			controls.target.lerp(activePresetAnimation.target, CAMERA_LERP_FACTOR);
			if (
				camera.position.distanceTo(activePresetAnimation.position) <
					CAMERA_ARRIVAL_THRESHOLD_M &&
				controls.target.distanceTo(activePresetAnimation.target) <
					CAMERA_ARRIVAL_THRESHOLD_M
			) {
				activePresetAnimation = null;
			}
		}
		controls.update();
	}

	renderer.render(scene, camera);
});
