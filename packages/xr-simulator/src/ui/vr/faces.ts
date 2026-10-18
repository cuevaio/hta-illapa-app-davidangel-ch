import { type AdvancedDynamicTexture, Rectangle } from "@babylonjs/gui";
import { readVrTheme, type VrButtonVariant, vrButtonStyle } from "./theme";
import { MayuText, mayuCard } from "./themeGui";

/** A Mayu button drawn over a whole texture (the face of a host's own 3D button mesh). */
export interface VrButtonFace {
	paint(state: { hovered: boolean; pressed: boolean }): void;
}

export function vrButtonFace(
	ui: AdvancedDynamicTexture,
	label: string,
	variant: VrButtonVariant,
): VrButtonFace {
	const theme = readVrTheme();
	ui.background = "transparent";
	const face = new Rectangle("button-face");
	face.width = face.height = "100%";
	face.cornerRadius = theme.radiusPx.control;
	face.thickness = theme.hairlinePx;
	const text = new MayuText(theme, "button", label);
	text.textWrapping = false;
	text.resizeToFit = true;
	face.addControl(text);
	ui.addControl(face);
	const paint: VrButtonFace["paint"] = (state) => {
		const style = vrButtonStyle(theme, variant, {
			...state,
			disabled: false,
			focused: false,
		});
		face.background = style.background;
		face.color = style.borderColor;
		text.color = style.color;
	};
	paint({ hovered: false, pressed: false });
	return { paint };
}

/** A Mayu card with one paragraph of body text (a host's hint plane). */
export function vrTextCard(
	ui: AdvancedDynamicTexture,
	text: string,
): { show(text: string): void } {
	const theme = readVrTheme();
	const card = mayuCard(ui, theme, {});
	const body = new MayuText(theme, "body", text);
	card.content.addControl(body);
	return { show: (next) => body.show(next) };
}
