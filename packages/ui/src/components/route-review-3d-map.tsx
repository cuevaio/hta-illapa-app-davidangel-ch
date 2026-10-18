import type { RouteRiskHorizon } from "@hack-the-andes-project/business/route-review/risk";
import { cn } from "cn";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ARButton } from "three/addons/webxr/ARButton.js";
import type { RouteReviewCandidate } from "../lib/route-review";
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
	COMPACT_HUD_MEDIA_QUERY,
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
	TABLE_DEPTH_M,
	TABLE_SELECTED_CAMERA_DISTANCE_FACTOR,
	TABLE_SELECTED_CAMERA_HEIGHT_FACTOR,
	TABLE_WIDTH_M,
	TONE_MAPPING_EXPOSURE,
	XR_RECENTER_DISTANCE_M,
	XR_TABLE_OFFSET_X_M,
	XR_TABLE_OFFSET_Y_M,
	XR_TABLE_OFFSET_Z_M,
} from "../lib/route-review-3d/constants";
import {
	buildRouteReviewTable,
	disposeSceneObject,
} from "../lib/route-review-3d/review-scene";
import {
	createTableFrame,
	loadRouteCorridors,
} from "../lib/route-review-3d/route";
import { buildSceneElements } from "../lib/route-review-3d/scene";
import type {
	CameraPreset,
	TableFrame,
	TableFrameCoordinate,
} from "../lib/route-review-3d/types";

export interface RouteReview3dPlace {
	name: string;
	lat: number;
	lng: number;
}

export interface RouteReview3dMapProps {
	vehicleAxleCount?: number;
	vehicleName?: string | null;
	selectedCandidateId?: string | null;
	candidates?: RouteReviewCandidate[];
	horizon?: RouteRiskHorizon;
	origin?: RouteReview3dPlace;
	destination?: RouteReview3dPlace;
	onSelectCandidate?: (candidateId: string) => void;
	className?: string;
}

interface ReviewRouteSnapshot {
	candidates: RouteReviewCandidate[];
	selectedCandidateId: string | null;
	horizon: RouteRiskHorizon;
	origin?: RouteReview3dPlace;
	destination?: RouteReview3dPlace;
	frame: TableFrame;
}

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

const PRESET_BUTTON_ITEMS = [
	{ key: "overview", label: "Vista general" },
	{ key: "hazard", label: "Huarochirí km 70–115" },
	{ key: "chosica", label: "Chosica km 35–80" },
	{ key: "ticlio", label: "Abra Ticlio (4 818 m)" },
	{ key: "detour", label: "Desvío SUTRAN Ruta 3" },
] as const;

const CARRIER_BUTTON_ITEMS = [
	{ key: "scania", label: "Scania R450 · C4P-512 (T2S3 · 5 ejes)" },
	{ key: "volvo", label: "Volvo FH 540 · F7K-829 (T3S3 · 6 ejes)" },
	{ key: "hino", label: "Hino 500 · B9X-301 (C3 · 3 ejes)" },
] as const;

function resolveInitialCarrierKey(
	vehicleAxleCount?: number,
	vehicleName?: string | null,
): string {
	const normalizedName = vehicleName?.toLowerCase() ?? "";
	if (normalizedName.includes("hino") || vehicleAxleCount === 3) {
		return "hino";
	}
	if (normalizedName.includes("volvo") || (vehicleAxleCount ?? 0) >= 6) {
		return "volvo";
	}
	return "scania";
}

export default function RouteReview3dMap({
	vehicleAxleCount,
	vehicleName,
	selectedCandidateId,
	candidates = [],
	horizon = "now",
	origin,
	destination,
	onSelectCandidate,
	className,
}: RouteReview3dMapProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const activatePresetRef = useRef<((presetKey: string) => void) | null>(null);
	const arButtonRef = useRef<HTMLElement | null>(null);
	const rebuildRouteRef = useRef<(() => void) | null>(null);
	const onSelectCandidateRef = useRef(onSelectCandidate);
	const routeSnapshotRef = useRef<ReviewRouteSnapshot | null>(null);

	const [activePreset, setActivePreset] = useState<string>("overview");
	const [activeCarrier, setActiveCarrier] = useState<string>(() =>
		resolveInitialCarrierKey(vehicleAxleCount, vehicleName),
	);
	const [xrSupported, setXrSupported] = useState(false);
	const [xrPresenting, setXrPresenting] = useState(false);
	const [hudCompact, setHudCompact] = useState(
		() => window.matchMedia(COMPACT_HUD_MEDIA_QUERY).matches,
	);
	const followsRoute = Boolean(origin && destination);

	const routeFrameKey = useMemo(() => {
		const coordinates: TableFrameCoordinate[] = [];
		if (origin) {
			coordinates.push({
				longitudeDegrees: origin.lng,
				latitudeDegrees: origin.lat,
			});
		}
		if (destination) {
			coordinates.push({
				longitudeDegrees: destination.lng,
				latitudeDegrees: destination.lat,
			});
		}
		for (const candidate of candidates) {
			for (const position of candidate.geometry.coordinates) {
				const longitudeDegrees = position[0];
				const latitudeDegrees = position[1];
				if (longitudeDegrees === undefined || latitudeDegrees === undefined) {
					continue;
				}
				coordinates.push({ longitudeDegrees, latitudeDegrees });
			}
		}
		const frame = createTableFrame(coordinates);
		routeSnapshotRef.current = {
			candidates,
			selectedCandidateId: selectedCandidateId ?? null,
			horizon,
			origin,
			destination,
			frame,
		};
		return [
			frame.minLongitudeDegrees,
			frame.maxLongitudeDegrees,
			frame.minLatitudeDegrees,
			frame.maxLatitudeDegrees,
			horizon,
			selectedCandidateId ?? "",
			candidates
				.map((candidate) => {
					const riskSignature = candidate.segments
						.map((segment) =>
							segment.risk
								.map((assessment) => `${assessment.horizon}${assessment.level}`)
								.join(""),
						)
						.join(",");
					return `${candidate.id}:${candidate.geometry.coordinates.length}:${candidate.eligibility.eligible}:${riskSignature}`;
				})
				.join("|"),
		].join(";");
	}, [candidates, destination, horizon, origin, selectedCandidateId]);

	useEffect(() => {
		setActiveCarrier(resolveInitialCarrierKey(vehicleAxleCount, vehicleName));
	}, [vehicleAxleCount, vehicleName]);

	useEffect(() => {
		onSelectCandidateRef.current = onSelectCandidate;
	}, [onSelectCandidate]);

	useEffect(() => {
		const containerElement = containerRef.current;
		const canvasElement = canvasRef.current;
		if (!containerElement || !canvasElement) return;

		const reducedMotionQuery = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		);
		let isReducedMotionPreferred = reducedMotionQuery.matches;
		const handleMotionChange = (mediaEvent: MediaQueryListEvent) => {
			isReducedMotionPreferred = mediaEvent.matches;
		};
		reducedMotionQuery.addEventListener("change", handleMotionChange);

		const initialWidth = Math.max(1, containerElement.clientWidth);
		const initialHeight = Math.max(1, containerElement.clientHeight);

		const renderer = new THREE.WebGLRenderer({
			canvas: canvasElement,
			antialias: true,
			alpha: true,
			powerPreference: "high-performance",
		});
		renderer.setSize(initialWidth, initialHeight);
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
			initialWidth / initialHeight,
			CAMERA_NEAR_M,
			CAMERA_FAR_M,
		);
		camera.position.set(
			INITIAL_CAMERA_X_M,
			INITIAL_CAMERA_Y_M,
			INITIAL_CAMERA_Z_M,
		);

		const controls = new OrbitControls(camera, renderer.domElement);
		controls.target.set(
			INITIAL_TARGET_X_M,
			INITIAL_TARGET_Y_M,
			INITIAL_TARGET_Z_M,
		);
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

		const tableAnchor = new THREE.Group();
		scene.add(tableAnchor);

		let activePresetAnimation: CameraPreset | null = null;
		let isHazardPinnedBySelection = false;
		let currentCarrierIdx = 0;
		let interactiveObjects: THREE.Object3D[] = [];
		let cameraPresets: Record<string, CameraPreset> = { ...CAMERA_PRESETS };
		let floatingCard:
			| ReturnType<typeof buildSceneElements>["floatingCard"]
			| null = null;
		let hazardMesh: ReturnType<typeof buildSceneElements>["hazardMesh"] | null =
			null;
		let updateAnimations: ReturnType<
			typeof buildSceneElements
		>["updateAnimations"] = () => {};

		function clearTable(): void {
			const children = [...tableAnchor.children];
			for (const child of children) {
				tableAnchor.remove(child);
				disposeSceneObject(child);
			}
			interactiveObjects = [];
			floatingCard = null;
			hazardMesh = null;
			updateAnimations = () => {};
		}

		function applyPreset(presetKey: string, preset: CameraPreset): void {
			setActivePreset(presetKey);
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
		}

		function setHazardVisualHighlight(isHighlighted: boolean): void {
			if (!floatingCard || !hazardMesh) return;
			const effectiveHighlight = isHighlighted || isHazardPinnedBySelection;
			floatingCard.setHighlight(effectiveHighlight);
			hazardMesh.material.emissive.set(
				effectiveHighlight ? HIGH_ORANGE_COLOR : BLACK_HEX_COLOR,
			);
			hazardMesh.material.emissiveIntensity = effectiveHighlight
				? HAZARD_EMISSIVE_HIGHLIGHT_INTENSITY
				: 0.0;
		}

		function activatePreset(presetKey: string): void {
			const preset = cameraPresets[presetKey];
			if (!preset) return;
			applyPreset(presetKey, preset);
			isHazardPinnedBySelection = presetKey === "hazard";
			setHazardVisualHighlight(presetKey === "hazard");
		}

		function mountQuestTable(): void {
			clearTable();
			cameraPresets = { ...CAMERA_PRESETS };
			const corridors = loadRouteCorridors();
			const built = buildSceneElements(corridors);
			tableAnchor.add(built.rootGroup);
			floatingCard = built.floatingCard;
			hazardMesh = built.hazardMesh;
			updateAnimations = built.updateAnimations;
			interactiveObjects = [
				built.hazardMesh,
				built.floatingCard.cardMesh,
				built.floatingCard.targetRing,
			];
		}

		function mountReviewTable(): boolean {
			const snapshot = routeSnapshotRef.current;
			if (!snapshot?.origin || !snapshot.destination) return false;
			clearTable();
			const built = buildRouteReviewTable({
				frame: snapshot.frame,
				candidates: snapshot.candidates,
				selectedCandidateId: snapshot.selectedCandidateId,
				horizon: snapshot.horizon,
				origin: {
					name: `A · ${snapshot.origin.name}`,
					longitudeDegrees: snapshot.origin.lng,
					latitudeDegrees: snapshot.origin.lat,
				},
				destination: {
					name: `B · ${snapshot.destination.name}`,
					longitudeDegrees: snapshot.destination.lng,
					latitudeDegrees: snapshot.destination.lat,
				},
			});
			tableAnchor.add(built.rootGroup);
			interactiveObjects = built.selectableMeshes;
			const frameDiagonalMeters = Math.hypot(
				snapshot.frame.widthMeters,
				snapshot.frame.depthMeters,
			);
			const referenceDiagonalMeters = Math.hypot(TABLE_WIDTH_M, TABLE_DEPTH_M);
			const cameraScale = Math.max(
				1,
				frameDiagonalMeters / referenceDiagonalMeters,
			);
			controls.maxDistance = ORBIT_MAX_DISTANCE_M * cameraScale;
			const overview: CameraPreset = {
				position: new THREE.Vector3(
					INITIAL_CAMERA_X_M * cameraScale,
					INITIAL_CAMERA_Y_M * cameraScale,
					INITIAL_CAMERA_Z_M * cameraScale,
				),
				target: new THREE.Vector3(
					INITIAL_TARGET_X_M,
					INITIAL_TARGET_Y_M,
					INITIAL_TARGET_Z_M,
				),
			};
			const selectedRoute: CameraPreset = {
				position: new THREE.Vector3(
					built.selectedFocus.x,
					INITIAL_CAMERA_Y_M *
						TABLE_SELECTED_CAMERA_HEIGHT_FACTOR *
						cameraScale,
					built.selectedFocus.z +
						INITIAL_CAMERA_Z_M *
							TABLE_SELECTED_CAMERA_DISTANCE_FACTOR *
							cameraScale,
				),
				target: built.selectedFocus.clone(),
			};
			cameraPresets = {
				...CAMERA_PRESETS,
				overview,
				selected: selectedRoute,
			};
			applyPreset(
				snapshot.selectedCandidateId ? "selected" : "overview",
				snapshot.selectedCandidateId ? selectedRoute : overview,
			);
			return true;
		}

		rebuildRouteRef.current = () => {
			if (!mountReviewTable()) mountQuestTable();
		};

		activatePresetRef.current = activatePreset;

		const handleControlsStart = () => {
			activePresetAnimation = null;
		};
		controls.addEventListener("start", handleControlsStart);

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

		function updateMouseNormalizedFromEvent(pointerEvent: PointerEvent): void {
			const bounds = renderer.domElement.getBoundingClientRect();
			if (bounds.width <= 0 || bounds.height <= 0) return;
			mouseNormalizedPosition.x =
				((pointerEvent.clientX - bounds.left) / bounds.width) * 2 - 1;
			mouseNormalizedPosition.y =
				-((pointerEvent.clientY - bounds.top) / bounds.height) * 2 + 1;
		}

		const handlePointerDown = (pointerEvent: PointerEvent) => {
			pointerDownScreenPosition.set(pointerEvent.clientX, pointerEvent.clientY);
		};

		const handlePointerMove = (pointerEvent: PointerEvent) => {
			if (renderer.xr.isPresenting) return;
			updateMouseNormalizedFromEvent(pointerEvent);
			desktopRaycaster.setFromCamera(mouseNormalizedPosition, camera);
			const intersections = desktopRaycaster.intersectObjects(
				interactiveObjects,
				false,
			);
			const isHoveringHazard = intersections.length > 0;
			setHazardVisualHighlight(isHoveringHazard);
			canvasElement.style.cursor = isHoveringHazard ? "pointer" : "grab";
		};

		const handlePointerUp = (pointerEvent: PointerEvent) => {
			if (renderer.xr.isPresenting) return;
			if (pointerEvent.target !== canvasElement) return;
			const dragDistancePx = Math.hypot(
				pointerEvent.clientX - pointerDownScreenPosition.x,
				pointerEvent.clientY - pointerDownScreenPosition.y,
			);
			if (dragDistancePx > POINTER_CLICK_DRAG_THRESHOLD_PX) return;

			updateMouseNormalizedFromEvent(pointerEvent);
			desktopRaycaster.setFromCamera(mouseNormalizedPosition, camera);
			const intersections = desktopRaycaster.intersectObjects(
				interactiveObjects,
				false,
			);
			const candidateId = intersections[0]?.object.userData.candidateId;
			if (typeof candidateId === "string") {
				onSelectCandidateRef.current?.(candidateId);
				return;
			}
			if (intersections.length > 0) {
				activatePreset("hazard");
			}
		};

		canvasElement.addEventListener("pointerdown", handlePointerDown);
		canvasElement.addEventListener("pointermove", handlePointerMove);
		canvasElement.addEventListener("pointerup", handlePointerUp);

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
				interactiveObjects,
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
				currentCarrierIdx = (currentCarrierIdx + 1) % CARRIER_KEYS_ORDER.length;
				const nextCarrierKey = CARRIER_KEYS_ORDER[currentCarrierIdx];
				if (nextCarrierKey) {
					setActiveCarrier(nextCarrierKey);
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

			tableAnchor.position.set(
				cameraWorldPosition.x +
					cameraForwardDirection.x * XR_RECENTER_DISTANCE_M,
				cameraWorldPosition.y + XR_TABLE_OFFSET_Y_M,
				cameraWorldPosition.z +
					cameraForwardDirection.z * XR_RECENTER_DISTANCE_M,
			);
			tableAnchor.rotation.set(
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
		// ARButton resets its own display once the XR support check resolves,
		// so hiding the button itself still shows "AR NOT SUPPORTED" on desktops.
		const arButtonHost = document.createElement("div");
		arButtonHost.hidden = true;
		arButtonHost.appendChild(threeArButtonElement);
		document.body.appendChild(arButtonHost);
		arButtonRef.current = threeArButtonElement;

		if (navigator.xr) {
			navigator.xr
				.isSessionSupported("immersive-ar")
				.then((supported) => {
					setXrSupported(supported);
				})
				.catch(() => {
					setXrSupported(false);
				});
		}

		const handleSessionStart = () => {
			activePresetAnimation = null;
			tableAnchor.position.set(
				XR_TABLE_OFFSET_X_M,
				XR_TABLE_OFFSET_Y_M,
				XR_TABLE_OFFSET_Z_M,
			);
			tableAnchor.rotation.set(0, 0, 0);
			setXrPresenting(true);
		};

		const handleSessionEnd = () => {
			tableAnchor.position.set(0, 0, 0);
			tableAnchor.rotation.set(0, 0, 0);
			setXrPresenting(false);
		};

		renderer.xr.addEventListener("sessionstart", handleSessionStart);
		renderer.xr.addEventListener("sessionend", handleSessionEnd);

		const resizeObserver = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			const nextWidth = Math.max(1, entry.contentRect.width);
			const nextHeight = Math.max(1, entry.contentRect.height);
			camera.aspect = nextWidth / nextHeight;
			camera.updateProjectionMatrix();
			renderer.setSize(nextWidth, nextHeight);
			renderer.setPixelRatio(
				Math.min(window.devicePixelRatio, MAX_DEVICE_PIXEL_RATIO),
			);
		});
		resizeObserver.observe(containerElement);

		const clock = new THREE.Clock();

		renderer.setAnimationLoop(() => {
			const deltaSeconds = clock.getDelta();
			const elapsedSeconds = clock.getElapsedTime();

			updateAnimations(deltaSeconds, elapsedSeconds, isReducedMotionPreferred);

			const activeCamera = renderer.xr.isPresenting
				? renderer.xr.getCamera()
				: camera;
			activeCamera.getWorldPosition(cameraWorldPosition);
			floatingCard?.faceCamera(cameraWorldPosition);

			if (renderer.xr.isPresenting) {
				const isPointedByController =
					isControllerPointingAtHazard(xrControllerPrimary) ||
					isControllerPointingAtHazard(xrControllerSecondary);
				setHazardVisualHighlight(isPointedByController);
			} else {
				if (activePresetAnimation) {
					camera.position.lerp(
						activePresetAnimation.position,
						CAMERA_LERP_FACTOR,
					);
					controls.target.lerp(
						activePresetAnimation.target,
						CAMERA_LERP_FACTOR,
					);
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

		return () => {
			rebuildRouteRef.current = null;
			disposeSceneObject(tableAnchor);
			renderer.setAnimationLoop(null);
			resizeObserver.disconnect();
			reducedMotionQuery.removeEventListener("change", handleMotionChange);
			canvasElement.removeEventListener("pointerdown", handlePointerDown);
			canvasElement.removeEventListener("pointermove", handlePointerMove);
			canvasElement.removeEventListener("pointerup", handlePointerUp);
			controls.removeEventListener("start", handleControlsStart);
			renderer.xr.removeEventListener("sessionstart", handleSessionStart);
			renderer.xr.removeEventListener("sessionend", handleSessionEnd);
			controls.dispose();
			renderer.dispose();
			arButtonHost.remove();
			arButtonRef.current = null;
			activatePresetRef.current = null;
		};
	}, []);

	useEffect(() => {
		if (routeFrameKey.length === 0) return;
		rebuildRouteRef.current?.();
	}, [routeFrameKey]);

	const routeSnapshot = routeSnapshotRef.current;
	const selectedCandidate = candidates.find(
		(candidate) => candidate.id === selectedCandidateId,
	);
	const longestRouteKm = routeSnapshot
		? Math.max(1, Math.round(routeSnapshot.frame.longestGroundMeters / 1000))
		: Math.round(TABLE_WIDTH_M);

	return (
		<div
			ref={containerRef}
			className={cn(
				"relative size-full overflow-hidden bg-[#f2f7f8] text-[#0a2530]",
				className,
			)}
			style={{
				backgroundImage:
					"radial-gradient(rgba(11, 110, 120, 0.14) 1px, transparent 1px)",
				backgroundSize: "24px 24px",
			}}
		>
			<canvas
				ref={canvasRef}
				className="block size-full cursor-grab active:cursor-grabbing"
			/>

			<div className="pointer-events-none absolute top-14 right-3 left-3 z-10 flex flex-wrap items-start justify-between gap-3">
				<div className="pointer-events-auto flex max-w-xl flex-col gap-2 rounded-lg border border-[#0a2530]/15 bg-white/95 p-3 backdrop-blur-md">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="flex flex-wrap items-center gap-2">
							<span className="type-label text-[#0b6e78]">
								{followsRoute
									? `MAQUETA 3D · ${selectedCandidate?.name ?? `${origin?.name ?? ""} – ${destination?.name ?? ""}`}`
									: "MAQUETA 3D · PE-22 LIMA – HUANCAYO"}
							</span>
							<span className="inline-flex items-center gap-1.5 rounded-md bg-[#d96200] px-2 py-0.5 font-mono font-semibold text-[#0a090b] text-[11px] uppercase tracking-wider">
								<span className="size-1.5 rounded-full bg-[#0a090b]" />
								{followsRoute
									? `Lado largo · ${longestRouteKm} km`
									: "Retrasar +18 h"}
							</span>
						</div>
						<button
							type="button"
							onClick={() => setHudCompact(!hudCompact)}
							className="rounded-sm border border-[#0a2530]/15 bg-[#f2f7f8] px-2 py-0.5 font-mono font-semibold text-[#0a2530] text-[10px] uppercase hover:border-[#0b6e78] hover:text-[#0b6e78]"
						>
							{hudCompact ? "Mostrar controles" : "Compactar"}
						</button>
					</div>

					{!hudCompact && followsRoute ? (
						<div className="flex flex-col gap-2 border-[#0a2530]/10 border-t pt-2">
							<div className="flex flex-wrap gap-1.5">
								<button
									type="button"
									onClick={() => activatePresetRef.current?.("overview")}
									className={cn(
										"rounded-md border px-2.5 py-1 font-semibold text-[11px] uppercase tracking-wider transition-colors",
										activePreset === "overview"
											? "border-[#0b6e78] bg-[#0b6e78] text-white"
											: "border-[#0a2530]/15 bg-[#f2f7f8] text-[#0a2530] hover:border-[#0b6e78] hover:text-[#0b6e78]",
									)}
								>
									Vista general
								</button>
								<button
									type="button"
									onClick={() => activatePresetRef.current?.("selected")}
									className={cn(
										"rounded-md border px-2.5 py-1 font-semibold text-[11px] uppercase tracking-wider transition-colors",
										activePreset === "selected"
											? "border-[#0b6e78] bg-[#0b6e78] text-white"
											: "border-[#0a2530]/15 bg-[#f2f7f8] text-[#0a2530] hover:border-[#0b6e78] hover:text-[#0b6e78]",
									)}
								>
									Ruta elegida
								</button>
							</div>
							<p className="text-[#4d6b74] text-xs">
								{candidates.length > 0
									? "La mesa encuadra toda la ruta, aunque sea larga, y conserva la proporción del mapa. El color sigue el riesgo del horizonte."
									: "La mesa ya encuadra origen y destino. Las cintas aparecen al calcular la ruta."}
							</p>
						</div>
					) : null}
					{!hudCompact && !followsRoute ? (
						<>
							<div className="flex flex-wrap items-center gap-1.5 border-[#0a2530]/10 border-t pt-2">
								<span className="type-label text-[#4d6b74]">UNIDAD:</span>
								{CARRIER_BUTTON_ITEMS.map((carrierItem) => (
									<button
										key={carrierItem.key}
										type="button"
										onClick={() => setActiveCarrier(carrierItem.key)}
										className={cn(
											"rounded-md border px-2 py-1 font-mono text-[11px] transition-colors",
											activeCarrier === carrierItem.key
												? "border-[#0a2530] bg-[#0a2530] font-semibold text-white"
												: "border-[#0a2530]/15 bg-[#e4eff1] text-[#0a2530] hover:border-[#0b6e78]",
										)}
									>
										{carrierItem.label}
									</button>
								))}
								<p className="w-full text-[#4d6b74] text-xs">
									{CARRIER_PROFILES[activeCarrier]}
								</p>
							</div>

							<div className="flex flex-wrap gap-1.5 pt-1">
								{PRESET_BUTTON_ITEMS.map((presetItem) => (
									<button
										key={presetItem.key}
										type="button"
										onClick={() => activatePresetRef.current?.(presetItem.key)}
										className={cn(
											"rounded-md border px-2.5 py-1 font-semibold text-[11px] uppercase tracking-wider transition-colors",
											activePreset === presetItem.key
												? "border-[#0b6e78] bg-[#0b6e78] text-white"
												: "border-[#0a2530]/15 bg-[#f2f7f8] text-[#0a2530] hover:border-[#0b6e78] hover:text-[#0b6e78]",
										)}
									>
										{presetItem.label}
									</button>
								))}
							</div>
						</>
					) : null}
				</div>

				<div className="pointer-events-auto flex max-w-64 flex-col items-end gap-1.5 rounded-lg border border-[#0a2530]/15 bg-white/95 p-3 backdrop-blur-md">
					<span className="type-label text-[#0b6e78]">
						REALIDAD MIXTA · QUEST 3
					</span>
					<button
						type="button"
						disabled={!xrSupported}
						onClick={() => arButtonRef.current?.click()}
						className={cn(
							"rounded-md border px-3 py-1.5 font-semibold text-xs uppercase tracking-wider transition-colors",
							xrSupported
								? "border-[#0b6e78] bg-[#0b6e78] text-white hover:bg-[#08555d]"
								: "cursor-default border-[#0a2530]/15 bg-[#e4eff1] text-[#4d6b74]",
						)}
					>
						{xrPresenting ? "Salir de la mesa" : "Ver en la mesa"}
					</button>
					<p className="text-right text-[#4d6b74] text-[11px] leading-tight">
						{xrSupported
							? "Meta Quest detectado. Proyecta la maqueta en tu mesa."
							: "Rota y acerca la maqueta con el cursor o ábrela en Quest 3."}
					</p>
				</div>
			</div>

			{followsRoute ? null : (
				<div className="pointer-events-none absolute right-3 bottom-3 left-3 z-10 flex flex-wrap items-end justify-between gap-3">
					<div className="pointer-events-auto flex flex-col gap-2 rounded-lg border border-[#0a2530]/15 bg-white/95 p-3 backdrop-blur-md">
						<span className="type-label text-[#0b6e78]">
							CINTAS Y SEÑALES SEPARADAS (PRONÓSTICO · BASE · DESVÍO)
						</span>
						<div className="flex flex-wrap gap-3 text-xs">
							<div className="flex items-center gap-1.5 font-semibold">
								<span className="h-2 w-4 rounded-xs border border-[#0a2530]/25 bg-[#d96200]" />
								<span>Lluvia SENAMHI · ahora (km 70–115 · Alto)</span>
							</div>
							<div className="flex items-center gap-1.5 font-semibold">
								<span className="h-2 w-4 rounded-xs border border-[#0a2530]/25 bg-[#e8bc00]" />
								<span>Salida +18 h · Moderado</span>
							</div>
							<div className="flex items-center gap-1.5 font-semibold">
								<span className="h-2 w-4 rounded-xs border border-[#0a2530]/25 bg-[#0b6e78]" />
								<span>Ruta 3 · Canta – Huayllay – Dv. Pasco</span>
							</div>
						</div>
						<div className="flex flex-wrap gap-1.5 border-[#0a2530]/10 border-t pt-1.5 font-mono text-[#4d6b74] text-[11px]">
							<button
								type="button"
								onClick={() => activatePresetRef.current?.("hazard")}
								className="rounded-xs border border-[#0a2530]/15 bg-[#f2f7f8] px-2 py-0.5 hover:border-[#0b6e78] hover:text-[#0b6e78]"
							>
								PRONÓSTICO · SENAMHI km 70–115 (25–40 mm)
							</button>
							<button
								type="button"
								onClick={() => activatePresetRef.current?.("chosica")}
								className="rounded-xs border border-[#0a2530]/15 bg-[#f2f7f8] px-2 py-0.5 hover:border-[#0b6e78] hover:text-[#0b6e78]"
							>
								BASE · INGEMMET km 35–80 (Chosica–Matucana)
							</button>
							<button
								type="button"
								onClick={() => activatePresetRef.current?.("ticlio")}
								className="rounded-xs border border-[#0a2530]/15 bg-[#f2f7f8] px-2 py-0.5 hover:border-[#0b6e78] hover:text-[#0b6e78]"
							>
								BASE · MTC km 120–140 (Abra Ticlio 4 818 m)
							</button>
						</div>
					</div>

					<button
						type="button"
						onClick={() => activatePresetRef.current?.("hazard")}
						title="Haz clic para enfocar Huarochirí (km 70 a 115)"
						className="pointer-events-auto hidden flex-col gap-1 rounded-lg border border-[#0a2530]/15 bg-white/95 p-3 text-left backdrop-blur-md hover:border-[#0b6e78] 2xl:flex"
					>
						<span className="type-label text-[#0b6e78]">
							PERFIL ALTITUDINAL · LIMA (150 M) → TICLIO (4 818 M) → HUANCAYO (3
							250 M)
						</span>
						<svg className="block h-[50px] w-[320px]" viewBox="0 0 340 54">
							<title>Perfil altitudinal Lima a Huancayo</title>
							<path
								d="M 8 48 L 48 41 L 85 28 L 128 16 L 152 6 L 195 15 L 265 19 L 332 20 L 332 50 L 8 50 Z"
								fill="rgba(216, 204, 168, 0.45)"
							/>
							<polyline
								points="8,48 48,41 85,28 128,16 152,6 195,15 265,19 332,20"
								fill="none"
								stroke="#1b333c"
								strokeWidth="2"
							/>
							<polyline
								points="85,28 106,22 128,16"
								fill="none"
								stroke="#d96200"
								strokeWidth="4"
							/>
							<polyline
								points="85,33 106,27 128,21"
								fill="none"
								stroke="#e8bc00"
								strokeWidth="3"
								strokeDasharray="4 2"
							/>
							<circle cx="8" cy="48" r="2.5" fill="#0a2530" />
							<circle cx="48" cy="41" r="2.5" fill="#0a2530" />
							<circle cx="106" cy="22" r="3.5" fill="#d96200" />
							<circle cx="152" cy="6" r="2.5" fill="#0b6e78" />
							<circle cx="332" cy="20" r="2.5" fill="#0a2530" />
							<text
								x="10"
								y="44"
								fontSize="8"
								fontFamily="monospace"
								fill="#0a2530"
							>
								Lima
							</text>
							<text
								x="38"
								y="36"
								fontSize="7.5"
								fontFamily="monospace"
								fill="#4d6b74"
							>
								Chosica
							</text>
							<text
								x="76"
								y="13"
								fontSize="8"
								fontWeight="bold"
								fontFamily="monospace"
								fill="#d96200"
							>
								km 70–115
							</text>
							<text
								x="142"
								y="18"
								fontSize="8"
								fontFamily="monospace"
								fill="#0b6e78"
							>
								Ticlio
							</text>
							<text
								x="290"
								y="15"
								fontSize="8"
								fontFamily="monospace"
								fill="#0a2530"
							>
								Huancayo
							</text>
						</svg>
					</button>
				</div>
			)}
		</div>
	);
}
