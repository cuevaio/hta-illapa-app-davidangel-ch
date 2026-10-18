import {
	type AdvancedDynamicTexture,
	Button,
	Control,
	type Image,
	Rectangle,
	TextBlock,
} from "@babylonjs/gui";
import { type IconName, iconDataUrl } from "../icons";
import {
	type VrTextRole,
	type VrTheme,
	vrButtonStyle,
	vrTextStyle,
} from "./theme";

/** Line height of VR text, as the web body (1.6). */
const LINE_HEIGHT_RATIO = 1.6;
const BUTTON_GAP_PX = "8px";

/** The menu's card: a Mayu surface with its radius and hairline border, no shadow. */
export function themedSurface(
	ui: AdvancedDynamicTexture,
	theme: VrTheme,
): void {
	ui.background = "transparent";
	const card = new Rectangle("surface");
	card.width = "100%";
	card.height = "100%";
	card.background = theme.surface;
	card.color = theme.line;
	card.thickness = theme.hairlinePx;
	card.cornerRadius = theme.surfaceRadiusPx;
	ui.addControl(card);
}

export function themedCase(role: VrTextRole, theme: VrTheme, text: string) {
	return vrTextStyle(theme, role).uppercase ? text.toUpperCase() : text;
}

/** A text block of one web type role; `sizePx` overrides the role size (e.g. a bigger title). */
export function themedText(
	theme: VrTheme,
	role: VrTextRole,
	text = "",
	sizePx?: number,
): TextBlock {
	const style = vrTextStyle(theme, role);
	const block = new TextBlock(undefined, themedCase(role, theme, text));
	block.fontFamily = style.fontFamily;
	block.fontWeight = style.fontWeight;
	block.fontSize = sizePx ?? style.fontSize;
	block.color = style.color;
	block.height = `${Math.round((sizePx ?? style.fontSize) * LINE_HEIGHT_RATIO)}px`;
	block.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	block.textWrapping = true;
	return block;
}

/** The shell of a Mayu control button (the content is laid out by each menu). */
export function themedButton(theme: VrTheme): Button {
	const button = new Button();
	button.background = theme.control;
	button.cornerRadius = theme.controlRadiusPx;
	button.thickness = 0;
	button.paddingLeft = button.paddingRight = BUTTON_GAP_PX;
	button.paddingTop = button.paddingBottom = BUTTON_GAP_PX;
	return button;
}

/** Paints a button for its state; returns the icon source now shown (to skip re-encoding it). */
export function paintButton(
	theme: VrTheme,
	parts: {
		button: Button;
		label: TextBlock | null;
		image: Image | null;
		icon: IconName | null;
		source: string;
	},
	state: { active: boolean; disabled: boolean },
): string {
	const style = vrButtonStyle(theme, state);
	parts.button.background = style.background;
	parts.button.alpha = style.alpha;
	parts.button.isEnabled = !state.disabled;
	if (parts.label) {
		parts.label.color = style.color;
		parts.label.fontFamily = vrTextStyle(theme, "button").fontFamily;
		parts.label.fontWeight = vrTextStyle(theme, "button").fontWeight;
	}
	if (!parts.image || !parts.icon) return parts.source;
	const source = iconDataUrl(parts.icon, style.color);
	if (source !== parts.source) parts.image.source = source;
	return source;
}
