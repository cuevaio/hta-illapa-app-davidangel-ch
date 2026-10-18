import { Mesh, MeshBuilder, type Scene } from "@babylonjs/core";
import { AdvancedDynamicTexture } from "@babylonjs/gui";
import type { Vec3 } from "../../map/flight";
import { metresOf, readVrTheme, texturePx, type VrTheme } from "./theme";
import { MayuText, mayuCard, mayuControl, mayuRow } from "./themeGui";

/** Size of the controls instructions card and of the attribution card under the controller (CSS px). */
export const INSTRUCTIONS_CARD_CSS = { width: 360, height: 400 } as const;
export const CREDIT_CARD_CSS = { width: 320, height: 110 } as const;

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

/** Imagery and weather attribution, in the `type-label` of the web map attribution. */
export function creditCard(
	ui: AdvancedDynamicTexture,
	theme: VrTheme,
): MayuText {
	const card = mayuCard(ui, theme, {});
	const text = new MayuText(theme, "label");
	card.content.addControl(text);
	return text;
}
