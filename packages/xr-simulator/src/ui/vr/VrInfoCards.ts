import type { AdvancedDynamicTexture } from "@babylonjs/gui";
import type { VrTheme } from "./theme";
import { MayuText, mayuCard } from "./themeGui";

/** Size of the controls card over the right controller and of the attribution card under it (CSS px). */
export const CONTROLS_CARD_CSS = { width: 320, height: 380 } as const;
export const CREDIT_CARD_CSS = { width: 320, height: 110 } as const;

/** "Controles": the controller mapping of the current view, as a web Card (S12). */
export function controlsCard(
	ui: AdvancedDynamicTexture,
	theme: VrTheme,
): MayuText {
	const card = mayuCard(ui, theme, { title: "Controles" });
	const text = new MayuText(theme, "body");
	card.content.addControl(text);
	return text;
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
