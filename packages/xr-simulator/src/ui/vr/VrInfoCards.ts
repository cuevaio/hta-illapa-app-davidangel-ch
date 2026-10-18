import { Mesh, MeshBuilder, type Scene } from "@babylonjs/core";
import { AdvancedDynamicTexture, Control, Rectangle } from "@babylonjs/gui";
import type { Vec3 } from "../../map/flight";
import type { CreditPose } from "../../xr/credit";
import {
	colorWithAlpha,
	metresOf,
	readVrTheme,
	texturePx,
	type VrTheme,
} from "./theme";
import { MayuText, mayuCard, mayuControl, mayuRow } from "./themeGui";

/** Size of the controls instructions card (CSS px). */
export const INSTRUCTIONS_CARD_CSS = { width: 360, height: 400 } as const;
/** The map credit label (S16), its padding (CSS px) and the opacity of its pill. */
export const CREDIT_LABEL_CSS = { width: 440, height: 96 } as const;
const CREDIT_PADDING_X_CSS_PX = 12;
const CREDIT_PADDING_Y_CSS_PX = 6;
const CREDIT_PILL_ALPHA = 0.8;

/**
 * "Controles" (S15): the controller mapping as a web Card with one primary «Entendido». It is
 * placed once in the world (instructionsPose) and stays there, never following the head or a
 * controller.
 */
export class VrInstructionsCard {
	readonly mesh: Mesh;
	private readonly ui: AdvancedDynamicTexture;
	private readonly text: MayuText;

	constructor(scene: Scene, onDismiss: () => void) {
		const theme = readVrTheme();
		this.mesh = MeshBuilder.CreatePlane(
			"vr-instructions",
			{
				width: metresOf(INSTRUCTIONS_CARD_CSS.width),
				height: metresOf(INSTRUCTIONS_CARD_CSS.height),
				sideOrientation: Mesh.DOUBLESIDE,
			},
			scene,
		);
		this.mesh.isPickable = true;
		this.ui = AdvancedDynamicTexture.CreateForMesh(
			this.mesh,
			texturePx(INSTRUCTIONS_CARD_CSS.width),
			texturePx(INSTRUCTIONS_CARD_CSS.height),
			false,
		);
		const card = mayuCard(this.ui, theme, { title: "Controles", footer: true });
		this.text = new MayuText(theme, "body");
		card.content.addControl(this.text);
		card.footer?.addControl(
			mayuRow([
				mayuControl(
					theme,
					{ kind: "button", variant: "default" },
					{ text: "Entendido" },
					onDismiss,
				).button,
			]),
		);
		this.mesh.setEnabled(false);
	}

	get visible(): boolean {
		return this.mesh.isEnabled();
	}

	/** Places the card (level, turned by `yaw` to face the user) and shows it. */
	showAt(pose: { position: Vec3; yaw: number }, text: string): void {
		this.mesh.position.set(...pose.position);
		this.mesh.rotation.set(0, pose.yaw, 0);
		this.text.show(text);
		this.mesh.setEnabled(true);
	}

	setText(text: string): void {
		this.text.show(text);
	}

	hide(): void {
		this.mesh.setEnabled(false);
	}

	dispose(): void {
		this.ui.dispose();
		this.mesh.dispose();
	}
}

/**
 * The map credit (S16): imagery and weather attribution in `type-label`, on a faint pill so it
 * stays legible over the relief; placed on the maquette's edge or low in the flight view.
 */
export class VrCreditLabel {
	readonly mesh: Mesh;
	private readonly ui: AdvancedDynamicTexture;
	private readonly text: MayuText;
	private readonly theme: VrTheme = readVrTheme();
	private shown = "";

	constructor(scene: Scene) {
		this.mesh = MeshBuilder.CreatePlane(
			"vr-map-credit",
			{
				width: metresOf(CREDIT_LABEL_CSS.width),
				height: metresOf(CREDIT_LABEL_CSS.height),
				sideOrientation: Mesh.DOUBLESIDE,
			},
			scene,
		);
		this.mesh.isPickable = false;
		this.ui = AdvancedDynamicTexture.CreateForMesh(
			this.mesh,
			texturePx(CREDIT_LABEL_CSS.width),
			texturePx(CREDIT_LABEL_CSS.height),
			false,
		);
		this.ui.background = "transparent";
		const pill = new Rectangle("credit-pill");
		pill.width = "100%";
		pill.adaptHeightToChildren = true;
		pill.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
		pill.background = colorWithAlpha(this.theme.colors.card, CREDIT_PILL_ALPHA);
		pill.color = this.theme.colors.border;
		pill.thickness = this.theme.hairlinePx;
		pill.cornerRadius = this.theme.radiusPx.control;
		this.text = new MayuText(this.theme, "label");
		this.text.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
		this.text.paddingTop =
			this.text.paddingBottom = `${texturePx(CREDIT_PADDING_Y_CSS_PX)}px`;
		this.text.paddingLeft =
			this.text.paddingRight = `${texturePx(CREDIT_PADDING_X_CSS_PX)}px`;
		pill.addControl(this.text);
		this.ui.addControl(pill);
		this.mesh.setEnabled(false);
	}

	get visible(): boolean {
		return this.mesh.isEnabled();
	}

	/** The credit text (null hides the label); the keyless prototype notice reads destructive. */
	show(content: { text: string; notice: boolean } | null): void {
		this.mesh.setEnabled(content !== null);
		if (!content) return;
		const key = `${content.notice}|${content.text}`;
		if (key === this.shown) return;
		this.shown = key;
		this.text.show(content.text);
		this.text.color = content.notice
			? this.theme.colors.destructive
			: this.theme.colors.mutedForeground;
	}

	place(pose: CreditPose): void {
		this.mesh.position.set(...pose.position);
		this.mesh.rotation.set(pose.tilt, pose.yaw, 0);
		this.mesh.scaling.setAll(pose.scale);
	}

	dispose(): void {
		this.ui.dispose();
		this.mesh.dispose();
	}
}
