import {
	Color4,
	type IWebXRAnchor,
	Quaternion,
	Scene,
	TransformNode,
	Vector3,
	type WebXRAbstractFeature,
	WebXRAnchorSystem,
	WebXRControllerPointerSelection,
	WebXRExperienceHelper,
	WebXRFeatureName,
	WebXRHandTracking,
	WebXRHitTest,
	WebXRInput,
	WebXRNearInteraction,
	WebXRSessionManager,
	WebXRState,
} from "@babylonjs/core";
import type {
	StructureXrController,
	StructureXrOptions,
} from "../lib/structure-xr-babylon";
import {
	MAQUETA_SCALE_RATIO,
	MAQUETA_SIZE_M,
	PANEL_OFFSET_X_M,
	PANEL_OFFSET_Y_M,
	PLACEMENT_FALLBACK_DELAY_MS,
	SUPPORT_RECHECK_INTERVAL_MS,
	SUPPORT_RECHECK_MAX_ATTEMPTS_COUNT,
	SURFACE_MIN_UP_DOT_RATIO,
	XR_CAMERA_FAR_M,
	XR_CAMERA_NEAR_M,
} from "./structure-xr-babylon/constants";
import { captureDesktopView } from "./structure-xr-babylon/desktop-view";
import {
	acquireLocalEmulator,
	type LocalEmulator,
} from "./structure-xr-babylon/emulator";
import {
	getFallbackTablePosition,
	getMaquetaOffset,
} from "./structure-xr-babylon/placement";
import {
	createXrVisuals,
	type XrVisuals,
} from "./structure-xr-babylon/visuals";

export async function createStructureXr(
	options: StructureXrOptions,
): Promise<StructureXrController> {
	const { scene, content, terrain, labels } = options;
	let helper: WebXRExperienceHelper | null = null;
	let input: WebXRInput | null = null;
	let emulator: LocalEmulator | null = null;
	let visuals: XrVisuals | null = null;
	const optionalFeatures: WebXRAbstractFeature[] = [];
	let renderTarget: ReturnType<
		WebXRSessionManager["getWebXRRenderTarget"]
	> | null = null;
	const reportError = () => options.onError(labels.error);
	const unavailableController: StructureXrController = {
		async enter() {
			reportError();
		},
		async exit() {},
		dispose() {},
	};
	try {
		let supported =
			typeof navigator !== "undefined" &&
			(await WebXRSessionManager.IsSessionSupportedAsync("immersive-ar"));
		options.onSupportChange(supported);
		emulator = await acquireLocalEmulator(supported);
		if (emulator) {
			for (
				let attempt = 0;
				attempt < SUPPORT_RECHECK_MAX_ATTEMPTS_COUNT;
				attempt += 1
			) {
				supported =
					await WebXRSessionManager.IsSessionSupportedAsync("immersive-ar");
				if (supported || scene.isDisposed) break;
				await new Promise<void>((resolve) =>
					setTimeout(resolve, SUPPORT_RECHECK_INTERVAL_MS),
				);
			}
			options.onSupportChange(supported);
		}
		if (!supported || scene.isDisposed) {
			emulator?.dispose();
			return unavailableController;
		}
		helper = await WebXRExperienceHelper.CreateAsync(scene);
		if (scene.isDisposed) {
			helper.dispose();
			emulator?.dispose();
			return unavailableController;
		}
		helper.camera.minZ = XR_CAMERA_NEAR_M;
		helper.camera.maxZ = XR_CAMERA_FAR_M;
		helper.camera.compensateOnFirstFrame = false;
		const experience = helper;
		const sessionManager = experience.sessionManager;
		const features = experience.featuresManager;
		input = new WebXRInput(sessionManager, experience.camera, {
			disableOnlineControllerRepository: true,
			doNotLoadControllerMeshes: true,
		});
		const xrInput = input;
		// A WebGPU engine renders XR through XRGPUBinding, which Babylon exposes via layers.
		if (options.webgpu)
			features.enableFeature(WebXRFeatureName.LAYERS, "stable");
		visuals = createXrVisuals(
			scene,
			experience.camera,
			labels,
			options.onUndo,
			() => {
				void controller.exit();
			},
		);
		const xrVisuals = visuals;
		const utilityScene = xrVisuals.manager.utilityLayer?.utilityLayerScene;
		const pointerSelection = features.enableFeature(
			WebXRControllerPointerSelection.Name,
			"latest",
			{
				xrInput: input,
				useUtilityLayer: true,
				customUtilityLayerScene: utilityScene,
				enablePointerSelectionOnAllControllers: true,
				disablePointerUpOnTouchOut: false,
				forceGazeMode: false,
				disableScenePointerVectorUpdate: false,
			},
		);
		features.enableFeature(WebXRNearInteraction.Name, "latest", {
			xrInput: input,
			useUtilityLayer: true,
			customUtilityLayerScene: utilityScene,
			farInteractionFeature: pointerSelection,
			enableNearInteractionOnAllControllers: true,
			motionControllerOrbMaterial: xrVisuals.interactionMaterial,
		});
		const hands = features.enableFeature(
			WebXRHandTracking.Name,
			"latest",
			{
				xrInput: input,
				handMeshes: { disableDefaultMeshes: true, disposeOnSessionEnd: true },
			},
			true,
			false,
		);
		optionalFeatures.push(hands);
		const hitTest = features.enableFeature(
			WebXRHitTest.Name,
			"latest",
			{},
			true,
			false,
		);
		optionalFeatures.push(hitTest);
		const anchors = features.enableFeature(
			WebXRAnchorSystem.Name,
			"latest",
			{},
			true,
			false,
		);
		optionalFeatures.push(anchors);
		renderTarget = sessionManager.getWebXRRenderTarget();
		const xrRenderTarget = renderTarget;
		const table = new TransformNode("xr-maqueta-table", scene);
		table.rotationQuaternion = Quaternion.Identity();
		const desktopParent = content.parent;
		let restoreCamera: (() => void) | null = null;
		let restoreEnvironment: (() => void) | null = null;
		let session: XRSession | null = null;
		let reportedActive = false;
		let placed = false;
		let hasSurface = false;
		let lastSurfaceOrStartMs = 0;
		let anchor: IWebXRAnchor | null = null;
		let disposed = false;
		let entering: Promise<void> | null = null;
		let exiting: Promise<void> | null = null;
		const surfaceUp = Vector3.Zero();
		const forward = Vector3.Zero();
		const panelOffset = new Vector3(PANEL_OFFSET_X_M, PANEL_OFFSET_Y_M, 0);
		const focus = { x: 0, z: 0 };
		let contentWasEnabled = content.isEnabled(false);

		const restoreDesktop = () => {
			session?.removeEventListener("select", placeAtReticle);
			session = null;
			anchor?.remove();
			anchor = null;
			placed = false;
			hasSurface = false;
			hitTest.paused = false;
			xrVisuals.reticle.setEnabled(false);
			xrVisuals.hint.setEnabled(false);
			xrVisuals.panel.setEnabled(false);
			if (!restoreCamera) return;
			content.parent = desktopParent;
			content.position.setAll(0);
			content.rotation.setAll(0);
			content.rotationQuaternion = null;
			content.scaling.setAll(1);
			content.setEnabled(contentWasEnabled);
			terrain.setClip(null);
			restoreEnvironment?.();
			restoreEnvironment = null;
			restoreCamera();
			restoreCamera = null;
			if (reportedActive) {
				reportedActive = false;
				options.onSessionChange(false);
			}
		};

		const placeAtReticle = () => {
			if (disposed || !session || placed || !xrVisuals.reticle.isEnabled())
				return;
			placed = true;
			table.position.copyFrom(xrVisuals.reticle.position);
			table.rotationQuaternion?.copyFrom(Quaternion.Identity());
			Object.assign(focus, options.getFocus() ?? { x: 0, z: 0 });
			terrain.setClip({ center: { ...focus }, sizeM: MAQUETA_SIZE_M });
			content.parent = table;
			content.rotation.setAll(0);
			content.rotationQuaternion = null;
			content.scaling.setAll(MAQUETA_SCALE_RATIO);
			xrVisuals.reticle.setEnabled(false);
			xrVisuals.hint.setEnabled(false);
			xrVisuals.panel.setEnabled(true);
			hitTest.paused = true;
			if (!anchors.attached) return;
			const placementSession = session;
			void anchors
				.addAnchorAtPositionAndRotationAsync(
					table.position.clone(),
					Quaternion.Identity(),
				)
				.then(
					(createdAnchor) => {
						if (disposed || session !== placementSession) {
							createdAnchor.remove();
							return;
						}
						anchor = createdAnchor;
						createdAnchor.attachedNode = table;
					},
					() => undefined,
				);
		};

		const hitObserver = hitTest.onHitTestResultObservable.add((results) => {
			if (!session || placed) return;
			const surface = results.find((result) => {
				Vector3.Up().rotateByQuaternionToRef(
					result.rotationQuaternion,
					surfaceUp,
				);
				return surfaceUp.y >= SURFACE_MIN_UP_DOT_RATIO;
			});
			hasSurface = Boolean(surface);
			if (surface) {
				lastSurfaceOrStartMs = performance.now();
				xrVisuals.reticle.position.copyFrom(surface.position);
				xrVisuals.reticle.setEnabled(true);
			} else {
				xrVisuals.reticle.setEnabled(false);
			}
		});
		const frameObserver = scene.onBeforeRenderObservable.add(() => {
			if (!session || disposed) return;
			if (!placed) {
				if (
					hasSurface ||
					performance.now() - lastSurfaceOrStartMs < PLACEMENT_FALLBACK_DELAY_MS
				)
					return;
				experience.camera.getDirectionToRef(
					Vector3.Forward(scene.useRightHandedSystem),
					forward,
				);
				const fallback = getFallbackTablePosition(
					experience.camera.globalPosition,
					forward,
				);
				xrVisuals.reticle.position.set(fallback.x, fallback.y, fallback.z);
				xrVisuals.reticle.setEnabled(true);
				return;
			}
			const elevationM = terrain.heightAt(focus);
			const offset = getMaquetaOffset(focus, elevationM ?? 0);
			content.position.set(offset.x, offset.y, offset.z);
			content.setEnabled(elevationM !== null);
			table.computeWorldMatrix(true);
			Vector3.TransformCoordinatesToRef(
				panelOffset,
				table.getWorldMatrix(),
				xrVisuals.panel.position,
			);
		});
		const sessionObserver = sessionManager.onXRSessionInit.add(
			(activeSession) => {
				if (disposed) return;
				session = activeSession;
				lastSurfaceOrStartMs = performance.now();
				xrVisuals.hint.setEnabled(true);
				session.addEventListener("select", placeAtReticle);
				reportedActive = true;
				options.onSessionChange(true);
			},
		);
		const stateObserver = experience.onStateChangedObservable.add((state) => {
			if (state === WebXRState.NOT_IN_XR) restoreDesktop();
		});

		const controller: StructureXrController = {
			enter() {
				if (disposed || session || exiting) return Promise.resolve();
				if (entering) return entering;
				entering = (async () => {
					try {
						restoreCamera = captureDesktopView(scene);
						const clearColor = scene.clearColor;
						const autoClear = scene.autoClear;
						const fogMode = scene.fogMode;
						restoreEnvironment = () => {
							scene.clearColor = clearColor;
							scene.autoClear = autoClear;
							scene.fogMode = fogMode;
						};
						scene.clearColor = new Color4(0, 0, 0, 0);
						scene.fogMode = Scene.FOGMODE_NONE;
						contentWasEnabled = content.isEnabled(false);
						content.setEnabled(false);
						await experience.enterXRAsync(
							"immersive-ar",
							"local-floor",
							xrRenderTarget,
						);
						if (disposed) await experience.exitXRAsync();
						else
							await options.join({
								baseExperience: experience,
								input: xrInput,
							});
					} catch {
						restoreDesktop();
						if (sessionManager.inXRSession) void experience.exitXRAsync();
						if (!disposed) reportError();
					} finally {
						entering = null;
					}
				})();
				return entering;
			},
			exit() {
				if (exiting) return exiting;
				exiting = (async () => {
					try {
						await entering;
						if (sessionManager.inXRSession) {
							await experience.exitXRAsync();
							if (sessionManager.inXRSession) {
								if (!disposed) reportError();
								return;
							}
						}
						restoreDesktop();
					} catch {
						if (!disposed) reportError();
					} finally {
						exiting = null;
					}
				})();
				return exiting;
			},
			dispose() {
				if (disposed) return;
				disposed = true;
				scene.onDisposeObservable.remove(disposeObserver);
				scene.onBeforeRenderObservable.remove(frameObserver);
				void controller.exit().finally(() => {
					restoreDesktop();
					stateObserver.remove();
					sessionObserver.remove();
					hitObserver.remove();
					features.dispose();
					for (const feature of optionalFeatures) {
						if (!feature.isDisposed) feature.dispose();
					}
					input?.dispose();
					xrRenderTarget.dispose();
					experience.dispose();
					xrVisuals.dispose();
					table.dispose();
					emulator?.dispose();
				});
			},
		};
		const disposeObserver = scene.onDisposeObservable.add(() =>
			controller.dispose(),
		);
		return controller;
	} catch {
		visuals?.dispose();
		input?.dispose();
		helper?.featuresManager.dispose();
		for (const feature of optionalFeatures) {
			if (!feature.isDisposed) feature.dispose();
		}
		helper?.dispose();
		renderTarget?.dispose();
		emulator?.dispose();
		options.onSupportChange(false);
		reportError();
		return unavailableController;
	}
}
