import type { ICanvasRenderingContext } from "@babylonjs/core";
import {
	type AdvancedDynamicTexture,
	Button,
	Control,
	Grid,
	Image,
	Rectangle,
	Slider,
	StackPanel,
	TextBlock,
} from "@babylonjs/gui";
import { type IconName, iconDataUrl } from "../icons";
import {
	BADGE_HEIGHT_CSS_PX,
	BUTTON_GAP_CSS_PX,
	BUTTON_HEIGHT_CSS_PX,
	BUTTON_PADDING_X_CSS_PX,
	CARD_HEADER_GAP_CSS_PX,
	CARD_SPACING_CSS_PX,
	CONTROL_GAP_CSS_PX,
	ICON_CSS_PX,
	texturePx,
	type VrButtonVariant,
	type VrControlState,
	type VrControlStyle,
	type VrTextRole,
	type VrTextStyle,
	type VrTheme,
	vrBadgeStyle,
	vrButtonStyle,
	vrTextStyle,
	vrToggleStyle,
} from "./theme";

/** Line box Babylon gives a line before `lineSpacing` (its font ascent + descent). */
const CANVAS_LINE_BOX_RATIO = 1.2;
/** slider.tsx: a 4px (h-1) pill track and a 12px (size-3) pill thumb; the band is the ray target. */
const SLIDER_TRACK_CSS_PX = 4;
const SLIDER_THUMB_CSS_PX = 12;
const SLIDER_BAND_CSS_PX = 24;

interface CanvasTypography {
	fontStretch: string;
	letterSpacing: string;
}

function hasTypography(
	context: ICanvasRenderingContext,
): context is ICanvasRenderingContext & CanvasTypography {
	return "fontStretch" in context && "letterSpacing" in context;
}

/** Every family and weight the VR cards draw; Canvas2D only uses a web font once it is loaded. */
const FONT_PROBES = [
	'800 expanded 16px "Archivo Variable"',
	'400 16px "Archivo Variable"',
	'500 16px "Archivo Variable"',
	'600 16px "Archivo Variable"',
	'500 16px "JetBrains Mono Variable"',
	'600 16px "JetBrains Mono Variable"',
];

const vrFontsReady: Promise<unknown> =
	typeof document !== "undefined" && document.fonts
		? Promise.all(FONT_PROBES.map((font) => document.fonts.load(font))).catch(
				() => undefined,
			)
		: Promise.resolve();

/**
 * Text of one web type role. Babylon GUI draws on a Canvas2D and only sets its `font`; the
 * expanded heading cut and the tracking go through the canvas `fontStretch` / `letterSpacing`
 * (Chromium, Quest Browser). Without them the text keeps the family, weight and size.
 */
export class MayuText extends TextBlock {
	private typography: VrTextStyle;

	constructor(
		theme: VrTheme,
		private readonly mayuRole: VrTextRole,
		text = "",
	) {
		super();
		this.typography = vrTextStyle(theme, mayuRole);
		this.fontFamily = this.typography.fontFamily;
		this.fontWeight = this.typography.fontWeight;
		this.fontSize = this.typography.fontSizePx;
		this.color = this.typography.color;
		this.lineSpacing = Math.max(
			0,
			this.typography.lineHeightPx -
				this.typography.fontSizePx * CANVAS_LINE_BOX_RATIO,
		);
		this.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		// Babylon centres a block ignoring `lineSpacing`, which pushes wrapped lines out of it.
		this.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		// Grows with its wrapped lines; controls that hold one line set a fixed height instead.
		this.textWrapping = true;
		this.resizeToFit = true;
		this.show(text);
		// Re-measure once the web fonts are in: the first layout may have used the fallback.
		void vrFontsReady.then(() => {
			const family = this.fontFamily;
			this.fontFamily = "";
			this.fontFamily = family;
		});
	}

	/** Sets the text, uppercased when the role is (the source stays sentence case, as on the web). */
	show(text: string): void {
		this.text = this.typography.uppercase ? text.toUpperCase() : text;
	}

	get textRole(): VrTextRole {
		return this.mayuRole;
	}

	protected override _applyStates(context: ICanvasRenderingContext): void {
		super._applyStates(context);
		if (!hasTypography(context)) return;
		context.fontStretch = this.typography.fontStretch;
		context.letterSpacing = `${this.typography.letterSpacingPx}px`;
	}
}

export interface MayuCard {
	root: Rectangle;
	title: MayuText | null;
	description: MayuText | null;
	content: StackPanel;
	footer: StackPanel | null;
}

/**
 * card.tsx: `bg-card`, 1px `border` hairline, `rounded-lg`, no shadow; a header (heading and an
 * optional muted description), the content and an optional footer under a top hairline, all
 * with the 16px `--card-spacing`. The card hugs its content from the top of the texture.
 */
export function mayuCard(
	ui: AdvancedDynamicTexture,
	theme: VrTheme,
	options: { title?: string; description?: boolean; footer?: boolean },
): MayuCard {
	ui.background = "transparent";
	const spacing = texturePx(CARD_SPACING_CSS_PX);
	const root = new Rectangle("card");
	root.width = "100%";
	root.adaptHeightToChildren = true;
	root.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	root.background = theme.colors.card;
	root.color = theme.colors.border;
	root.thickness = theme.hairlinePx;
	root.cornerRadius = theme.radiusPx.surface;
	ui.addControl(root);

	const body = new StackPanel("card-body");
	body.width = "100%";
	body.spacing = spacing;
	body.paddingTop = `${spacing}px`;
	body.paddingBottom = options.footer ? "0px" : `${spacing}px`;
	root.addControl(body);

	const header = new StackPanel("card-header");
	header.width = "100%";
	header.spacing = texturePx(CARD_HEADER_GAP_CSS_PX);
	header.paddingLeft = header.paddingRight = `${spacing}px`;
	const title = options.title
		? new MayuText(theme, "heading", options.title)
		: null;
	if (title) header.addControl(title);
	let description: MayuText | null = null;
	if (options.description) {
		description = new MayuText(theme, "body");
		description.color = theme.colors.mutedForeground;
		header.addControl(description);
	}
	if (title || description) body.addControl(header);

	const content = new StackPanel("card-content");
	content.width = "100%";
	content.spacing = texturePx(CONTROL_GAP_CSS_PX);
	content.paddingLeft = content.paddingRight = `${spacing}px`;
	body.addControl(content);

	let footer: StackPanel | null = null;
	if (options.footer) {
		const footerBox = new StackPanel("card-footer");
		footerBox.width = "100%";
		const rule = new Rectangle("card-footer-rule");
		rule.width = "100%";
		rule.height = `${theme.hairlinePx}px`;
		rule.thickness = 0;
		rule.background = theme.colors.border;
		footerBox.addControl(rule);
		footer = new StackPanel("card-footer-content");
		footer.width = "100%";
		footer.spacing = texturePx(CONTROL_GAP_CSS_PX);
		footer.paddingLeft = footer.paddingRight = `${spacing}px`;
		footer.paddingTop = footer.paddingBottom = `${spacing}px`;
		footerBox.addControl(footer);
		body.addControl(footerBox);
	}
	return { root, title, description, content, footer };
}

/** A `type-label` section title inside a card. */
export function mayuLabel(theme: VrTheme, text: string): MayuText {
	return new MayuText(theme, "label", text);
}

export type MayuControlKind =
	| { kind: "button"; variant: VrButtonVariant }
	| { kind: "toggle" };

export interface MayuControl {
	button: Button;
	/** Repaints for `on` (toggles) and `disabled`; hover and press are tracked from the ray. */
	set(state: { on?: boolean; disabled?: boolean }): void;
	setText(text: string): void;
	setIcon(icon: IconName): void;
}

/**
 * A web Button (button.tsx, size `lg`) or Toggle (toggle.tsx, `outline`): `rounded-md`, icon and
 * text centred with a 6px gap, hover wash under the controller ray, 50 % when disabled.
 */
export function mayuControl(
	theme: VrTheme,
	kind: MayuControlKind,
	content: { icon?: IconName | null; text?: string },
	onClick: () => void,
): MayuControl {
	const button = new Button();
	button.height = `${texturePx(BUTTON_HEIGHT_CSS_PX)}px`;
	button.cornerRadius = theme.radiusPx.control;
	button.thickness = theme.hairlinePx;
	button.paddingLeft = button.paddingRight = "0px";
	const row = new StackPanel("control-content");
	row.isVertical = false;
	row.spacing = texturePx(BUTTON_GAP_CSS_PX);
	row.height = "100%";
	row.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
	row.paddingLeft =
		row.paddingRight = `${texturePx(BUTTON_PADDING_X_CSS_PX)}px`;
	let image: Image | null = null;
	let icon = content.icon ?? null;
	if (icon) {
		image = new Image();
		image.width = image.height = `${texturePx(ICON_CSS_PX)}px`;
		image.stretch = Image.STRETCH_UNIFORM;
		row.addControl(image);
	}
	let label: MayuText | null = null;
	if (content.text) {
		label = new MayuText(
			theme,
			kind.kind === "toggle" ? "toggle" : "button",
			content.text,
		);
		label.resizeToFit = true;
		label.textWrapping = false;
		label.height = "100%";
		row.addControl(label);
	}
	button.addControl(row);

	const state: VrControlState & { on: boolean } = {
		hovered: false,
		pressed: false,
		disabled: false,
		focused: false,
		on: false,
	};
	let source = "";
	const paint = () => {
		const style: VrControlStyle =
			kind.kind === "toggle"
				? vrToggleStyle(theme, state)
				: vrButtonStyle(theme, kind.variant, state);
		button.background = style.background;
		button.color = style.borderColor;
		button.alpha = style.alpha;
		button.isEnabled = !state.disabled;
		if (label) label.color = style.color;
		if (image && icon) {
			const next = iconDataUrl(icon, style.color);
			if (next !== source) {
				image.source = next;
				source = next;
			}
		}
	};
	button.onPointerEnterObservable.add(() => {
		state.hovered = true;
		paint();
	});
	button.onPointerOutObservable.add(() => {
		state.hovered = state.pressed = false;
		paint();
	});
	button.onPointerDownObservable.add(() => {
		state.pressed = true;
		paint();
	});
	button.onPointerUpObservable.add(() => {
		state.pressed = false;
		paint();
	});
	button.onPointerClickObservable.add(() => {
		if (button.isEnabled) onClick();
	});
	// The pointer feedback is ours: no Babylon scale or colour animation on top.
	button.pointerEnterAnimation = () => {};
	button.pointerOutAnimation = () => {};
	button.pointerDownAnimation = () => {};
	button.pointerUpAnimation = () => {};
	paint();
	return {
		button,
		set(next) {
			if (next.on !== undefined) state.on = next.on;
			if (next.disabled !== undefined) state.disabled = next.disabled;
			paint();
		},
		setText(text) {
			label?.show(text);
		},
		setIcon(next) {
			icon = next;
			paint();
		},
	};
}

/** A row of controls with the 8px gap, equal widths unless weighted. */
export function mayuRow(
	controls: Control[],
	weights: number[] = controls.map(() => 1),
): Grid {
	const row = new Grid("control-row");
	row.width = "100%";
	row.height = `${texturePx(BUTTON_HEIGHT_CSS_PX)}px`;
	const halfGap = `${texturePx(CONTROL_GAP_CSS_PX) / 2}px`;
	controls.forEach((control, index) => {
		const total = weights.reduce((sum, weight) => sum + weight, 0);
		row.addColumnDefinition((weights[index] ?? 1) / total);
		if (index > 0) control.paddingLeft = halfGap;
		if (index < controls.length - 1) control.paddingRight = halfGap;
		row.addControl(control, 0, index);
	});
	return row;
}

/** badge.tsx: `type-label` on a `rounded-md` fill, h-5 px-2. */
export function mayuBadge(
	theme: VrTheme,
	variant: "default" | "secondary",
	text: string,
): Rectangle {
	const style = vrBadgeStyle(theme, variant);
	const badge = new Rectangle("badge");
	badge.height = `${texturePx(BADGE_HEIGHT_CSS_PX)}px`;
	badge.adaptWidthToChildren = true;
	badge.thickness = 0;
	badge.cornerRadius = theme.radiusPx.control;
	badge.background = style.background;
	const label = new MayuText(theme, "label", text);
	label.color = style.color;
	label.resizeToFit = true;
	label.textWrapping = false;
	label.height = "100%";
	label.paddingLeft = label.paddingRight = `${texturePx(8)}px`;
	badge.addControl(label);
	return badge;
}

/** slider.tsx: `muted` pill track, `primary` range, a `background` thumb with a `ring` border. */
export function mayuSlider(theme: VrTheme): Slider {
	const slider = new Slider();
	slider.height = `${texturePx(SLIDER_BAND_CSS_PX)}px`;
	slider.width = "100%";
	slider.barOffset = `${texturePx((SLIDER_BAND_CSS_PX - SLIDER_TRACK_CSS_PX) / 2)}px`;
	slider.background = theme.colors.muted;
	slider.color = theme.colors.primary;
	slider.thumbColor = theme.colors.background;
	slider.borderColor = theme.colors.ring;
	slider.isThumbCircle = true;
	slider.thumbWidth = `${texturePx(SLIDER_THUMB_CSS_PX)}px`;
	slider.displayValueBar = true;
	return slider;
}
