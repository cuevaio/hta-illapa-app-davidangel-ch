import {
	type Camera,
	Color3,
	type Material,
	Mesh,
	MeshBuilder,
	type Scene,
	StandardMaterial,
	TransformNode,
} from "@babylonjs/core";
import {
	AdvancedDynamicTexture,
	GUI3DManager,
	TouchMeshButton3D,
} from "@babylonjs/gui";
import {
	VR_BUTTON_HEIGHT_CSS_PX,
	VR_CONTROL_GAP_CSS_PX,
	vrButtonFace,
	vrMetresOf,
	vrTextCard,
	vrTexturePx,
} from "@hack-the-andes-project/xr-simulator/viewer";
import type { StructureXrLabels } from "../../lib/structure-xr-babylon";
import {
	DEFAULT_RING_COLOR,
	HINT_CSS_PX,
	HINT_DISTANCE_M,
	HINT_VERTICAL_OFFSET_M,
	PANEL_BUTTON_DEPTH_M,
	PANEL_BUTTON_WIDTH_CSS_PX,
	PANEL_FIRST_BUTTON_OFFSET_RATIO,
	PANEL_LABEL_OFFSET_M,
	RETICLE_DIAMETER_M,
	RETICLE_SEGMENTS_COUNT,
	RETICLE_SURFACE_OFFSET_M,
	RETICLE_THICKNESS_M,
} from "./constants";

export interface XrVisuals {
	manager: GUI3DManager;
	interactionMaterial: StandardMaterial;
	reticle: TransformNode;
	hint: Mesh;
	panel: TransformNode;
	/** "Volver al mapa del Perú", shown by the session while the map is reachable. */
	backButton: TransformNode;
	dispose(): void;
}

export function createXrVisuals(
	scene: Scene,
	camera: Camera,
	labels: StructureXrLabels,
	onUndo: () => void,
	onExit: () => void,
	backToMap: { label: string; invoke: () => void },
): XrVisuals {
	const styles = getComputedStyle(document.documentElement);
	const ringColor =
		styles.getPropertyValue("--ring").trim() || DEFAULT_RING_COLOR;
	const textures: AdvancedDynamicTexture[] = [];
	const materials: Material[] = [];
	const manager = new GUI3DManager(scene);
	const utilityScene = manager.utilityLayer?.utilityLayerScene ?? scene;
	utilityScene.useRightHandedSystem = true;
	const interactionMaterial = new StandardMaterial(
		"xr-near-interaction-material",
		utilityScene,
	);
	interactionMaterial.disableLighting = true;
	interactionMaterial.emissiveColor = Color3.FromHexString(ringColor);
	materials.push(interactionMaterial);
	const reticle = new TransformNode("xr-placement-reticle", scene);
	const ring = MeshBuilder.CreateTorus(
		"xr-placement-ring",
		{
			diameter: RETICLE_DIAMETER_M,
			thickness: RETICLE_THICKNESS_M,
			tessellation: RETICLE_SEGMENTS_COUNT,
		},
		scene,
	);
	ring.parent = reticle;
	ring.position.y = RETICLE_SURFACE_OFFSET_M;
	ring.isPickable = false;
	const ringMaterial = new StandardMaterial(
		"xr-placement-ring-material",
		scene,
	);
	ringMaterial.emissiveColor = Color3.FromHexString(ringColor);
	ringMaterial.disableLighting = true;
	ring.material = ringMaterial;
	materials.push(ringMaterial);
	reticle.setEnabled(false);

	// A Mayu card (S12): the web Card at the shared VR scale.
	const hint = MeshBuilder.CreatePlane(
		"xr-placement-hint",
		{
			width: vrMetresOf(HINT_CSS_PX.width),
			height: vrMetresOf(HINT_CSS_PX.height),
			sideOrientation: Mesh.DOUBLESIDE,
		},
		scene,
	);
	hint.parent = camera;
	hint.position.set(0, HINT_VERTICAL_OFFSET_M, -HINT_DISTANCE_M);
	hint.isPickable = false;
	const hintTexture = AdvancedDynamicTexture.CreateForMesh(
		hint,
		vrTexturePx(HINT_CSS_PX.width),
		vrTexturePx(HINT_CSS_PX.height),
		false,
	);
	vrTextCard(hintTexture, labels.placeTable);
	textures.push(hintTexture);
	if (hint.material) materials.push(hint.material);
	hint.setEnabled(false);

	const buttonWidthM = vrMetresOf(PANEL_BUTTON_WIDTH_CSS_PX);
	const buttonHeightM = vrMetresOf(VR_BUTTON_HEIGHT_CSS_PX);
	const buttonGapM = vrMetresOf(VR_CONTROL_GAP_CSS_PX);
	const panel = new TransformNode("xr-actions", utilityScene);
	const buttonMeshes: Mesh[] = [];
	panel.billboardMode = TransformNode.BILLBOARDMODE_ALL;
	for (const [buttonIndex, action] of [
		{ label: labels.undo, invoke: onUndo, variant: "outline" as const },
		{ label: labels.exit, invoke: onExit, variant: "outline" as const },
		// The panel's one primary action, as on the web: back to the map.
		{ ...backToMap, variant: "default" as const },
	].entries()) {
		const buttonMesh = MeshBuilder.CreateBox(
			`xr-action-${buttonIndex}`,
			{
				width: buttonWidthM,
				height: buttonHeightM,
				depth: PANEL_BUTTON_DEPTH_M,
			},
			utilityScene,
		);
		const buttonMaterial = new StandardMaterial(
			`xr-action-material-${buttonIndex}`,
			utilityScene,
		);
		// The box only catches the controller; the Mayu face on the label plane is what shows.
		buttonMaterial.alpha = 0;
		buttonMesh.material = buttonMaterial;
		materials.push(buttonMaterial);
		const labelPlane = MeshBuilder.CreatePlane(
			`xr-action-label-${buttonIndex}`,
			{
				width: buttonWidthM,
				height: buttonHeightM,
				sideOrientation: Mesh.DOUBLESIDE,
			},
			utilityScene,
		);
		labelPlane.parent = buttonMesh;
		labelPlane.position.z = -PANEL_LABEL_OFFSET_M;
		labelPlane.isPickable = false;
		const labelTexture = AdvancedDynamicTexture.CreateForMesh(
			labelPlane,
			vrTexturePx(PANEL_BUTTON_WIDTH_CSS_PX),
			vrTexturePx(VR_BUTTON_HEIGHT_CSS_PX),
			false,
		);
		const face = vrButtonFace(labelTexture, action.label, action.variant);
		textures.push(labelTexture);
		if (labelPlane.material) materials.push(labelPlane.material);
		const button = new TouchMeshButton3D(
			buttonMesh,
			`xr-action-${buttonIndex}`,
		);
		manager.addControl(button);
		buttonMesh.parent = panel;
		button.position.y =
			(buttonHeightM + buttonGapM) *
			(PANEL_FIRST_BUTTON_OFFSET_RATIO - buttonIndex);
		button.collidableFrontDirection.setAll(0);
		let hovered = false;
		let pressed = false;
		const updateFeedback = () => face.paint({ hovered, pressed });
		button.pointerEnterAnimation = () => {
			hovered = true;
			updateFeedback();
		};
		button.pointerOutAnimation = () => {
			hovered = false;
			pressed = false;
			updateFeedback();
		};
		button.pointerDownAnimation = () => {
			pressed = true;
			updateFeedback();
		};
		button.pointerUpAnimation = () => {
			pressed = false;
			updateFeedback();
		};
		button.onPointerClickObservable.add(action.invoke);
		buttonMeshes.push(buttonMesh);
	}
	const backButton = buttonMeshes.at(-1) ?? panel;
	backButton.setEnabled(false);
	panel.setEnabled(false);
	return {
		manager,
		interactionMaterial,
		reticle,
		hint,
		panel,
		backButton,
		dispose() {
			manager.dispose();
			panel.dispose();
			reticle.dispose();
			hint.dispose();
			for (const texture of textures) texture.dispose();
			for (const material of materials) material.dispose();
		},
	};
}
