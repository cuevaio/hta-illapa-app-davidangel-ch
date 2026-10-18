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
	TextBlock,
	TouchMeshButton3D,
} from "@babylonjs/gui";
import type { StructureXrLabels } from "../../lib/structure-xr-babylon";
import {
	DEFAULT_ACCENT_COLOR,
	DEFAULT_CARD_COLOR,
	DEFAULT_FOREGROUND_COLOR,
	DEFAULT_PRIMARY_COLOR,
	DEFAULT_PRIMARY_FOREGROUND_COLOR,
	DEFAULT_RING_COLOR,
	DEFAULT_SECONDARY_COLOR,
	HINT_DISTANCE_M,
	HINT_FONT_SIZE_PX,
	HINT_HEIGHT_M,
	HINT_TEXTURE_HEIGHT_PX,
	HINT_TEXTURE_WIDTH_PX,
	HINT_VERTICAL_OFFSET_M,
	HINT_WIDTH_M,
	PANEL_BUTTON_DEPTH_M,
	PANEL_BUTTON_GAP_M,
	PANEL_BUTTON_HEIGHT_M,
	PANEL_BUTTON_WIDTH_M,
	PANEL_FIRST_BUTTON_OFFSET_RATIO,
	PANEL_FONT_SIZE_PX,
	PANEL_FONT_WEIGHT,
	PANEL_HOVER_SCALE_RATIO,
	PANEL_LABEL_OFFSET_M,
	PANEL_PRESSED_SCALE_RATIO,
	PANEL_TEXTURE_HEIGHT_PX,
	PANEL_TEXTURE_WIDTH_PX,
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
	const cardColor =
		styles.getPropertyValue("--card").trim() || DEFAULT_CARD_COLOR;
	const foregroundColor =
		styles.getPropertyValue("--foreground").trim() || DEFAULT_FOREGROUND_COLOR;
	const accentColor =
		styles.getPropertyValue("--accent").trim() || DEFAULT_ACCENT_COLOR;
	const secondaryColor =
		styles.getPropertyValue("--secondary").trim() || DEFAULT_SECONDARY_COLOR;
	const primaryColor =
		styles.getPropertyValue("--primary").trim() || DEFAULT_PRIMARY_COLOR;
	const primaryForegroundColor =
		styles.getPropertyValue("--primary-foreground").trim() ||
		DEFAULT_PRIMARY_FOREGROUND_COLOR;
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

	const hint = MeshBuilder.CreatePlane(
		"xr-placement-hint",
		{
			width: HINT_WIDTH_M,
			height: HINT_HEIGHT_M,
			sideOrientation: Mesh.DOUBLESIDE,
		},
		scene,
	);
	hint.parent = camera;
	hint.position.set(0, HINT_VERTICAL_OFFSET_M, -HINT_DISTANCE_M);
	hint.isPickable = false;
	const hintTexture = AdvancedDynamicTexture.CreateForMesh(
		hint,
		HINT_TEXTURE_WIDTH_PX,
		HINT_TEXTURE_HEIGHT_PX,
		false,
	);
	hintTexture.background = cardColor;
	const hintLabel = new TextBlock("xr-placement-hint-label", labels.placeTable);
	hintLabel.color = foregroundColor;
	hintLabel.fontFamily = "Archivo Variable, sans-serif";
	hintLabel.fontSize = HINT_FONT_SIZE_PX;
	hintLabel.textWrapping = true;
	hintTexture.addControl(hintLabel);
	textures.push(hintTexture);
	if (hint.material) materials.push(hint.material);
	hint.setEnabled(false);

	const panel = new TransformNode("xr-actions", utilityScene);
	const buttonMeshes: Mesh[] = [];
	panel.billboardMode = TransformNode.BILLBOARDMODE_ALL;
	for (const [buttonIndex, action] of [
		{ label: labels.undo, invoke: onUndo },
		{ label: labels.exit, invoke: onExit },
		backToMap,
	].entries()) {
		const buttonMesh = MeshBuilder.CreateBox(
			`xr-action-${buttonIndex}`,
			{
				width: PANEL_BUTTON_WIDTH_M,
				height: PANEL_BUTTON_HEIGHT_M,
				depth: PANEL_BUTTON_DEPTH_M,
			},
			utilityScene,
		);
		const buttonMaterial = new StandardMaterial(
			`xr-action-material-${buttonIndex}`,
			utilityScene,
		);
		buttonMaterial.disableLighting = true;
		buttonMaterial.emissiveColor = Color3.FromHexString(secondaryColor);
		buttonMesh.material = buttonMaterial;
		materials.push(buttonMaterial);
		const labelPlane = MeshBuilder.CreatePlane(
			`xr-action-label-${buttonIndex}`,
			{
				width: PANEL_BUTTON_WIDTH_M,
				height: PANEL_BUTTON_HEIGHT_M,
				sideOrientation: Mesh.DOUBLESIDE,
			},
			utilityScene,
		);
		labelPlane.parent = buttonMesh;
		labelPlane.position.z = -PANEL_LABEL_OFFSET_M;
		labelPlane.isPickable = false;
		const labelTexture = AdvancedDynamicTexture.CreateForMesh(
			labelPlane,
			PANEL_TEXTURE_WIDTH_PX,
			PANEL_TEXTURE_HEIGHT_PX,
			false,
		);
		const buttonLabel = new TextBlock(
			`xr-action-text-${buttonIndex}`,
			action.label.toUpperCase(),
		);
		buttonLabel.color = foregroundColor;
		buttonLabel.fontFamily = "Archivo Variable, sans-serif";
		buttonLabel.fontWeight = PANEL_FONT_WEIGHT;
		buttonLabel.fontSize = PANEL_FONT_SIZE_PX;
		labelTexture.addControl(buttonLabel);
		textures.push(labelTexture);
		if (labelPlane.material) materials.push(labelPlane.material);
		const button = new TouchMeshButton3D(
			buttonMesh,
			`xr-action-${buttonIndex}`,
		);
		manager.addControl(button);
		buttonMesh.parent = panel;
		button.position.y =
			(PANEL_BUTTON_HEIGHT_M + PANEL_BUTTON_GAP_M) *
			(PANEL_FIRST_BUTTON_OFFSET_RATIO - buttonIndex);
		button.collidableFrontDirection.setAll(0);
		let hovered = false;
		let pressed = false;
		const updateFeedback = () => {
			buttonMaterial.emissiveColor = Color3.FromHexString(
				pressed ? primaryColor : hovered ? accentColor : secondaryColor,
			);
			buttonLabel.color = pressed ? primaryForegroundColor : foregroundColor;
			buttonMesh.scaling.setAll(
				pressed
					? PANEL_PRESSED_SCALE_RATIO
					: hovered
						? PANEL_HOVER_SCALE_RATIO
						: 1,
			);
		};
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
