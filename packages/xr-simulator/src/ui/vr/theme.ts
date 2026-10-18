/**
 * The web design system "Mayu" (docs/DESIGN.md, tokens in packages/ui/src/styles/globals.css,
 * components in packages/ui) for the VR cards and menus (S9, S12). Babylon GUI cannot read CSS
 * variables, so the page's live tokens are read once per card and fall back to the DESIGN.md
 * light values on a page without them. Every length is a web CSS px, scaled by one factor.
 */

/**
 * Texture px per web CSS px: a 3× device pixel ratio, sharp at arm's length.
 * Metres per web CSS px: 1.25 mm, so the 15px body text is about 19 mm tall and a 36px button
 * 45 mm, a legible size and a comfortable ray target in a headset.
 */
export const VR_TEXTURE_PX_PER_CSS_PX = 3;
export const VR_METRES_PER_CSS_PX = 0.00125;

export function texturePx(cssPx: number): number {
	return cssPx * VR_TEXTURE_PX_PER_CSS_PX;
}

export function metresOf(cssPx: number): number {
	return cssPx * VR_METRES_PER_CSS_PX;
}

/** DESIGN.md "Shapes". */
export const MAYU_RADIUS_CSS_PX = {
	inner: 6,
	control: 10,
	surface: 14,
	full: 9999,
} as const;

/** card.tsx: `--card-spacing` (padding and gap) and the header's title/description gap. */
export const CARD_SPACING_CSS_PX = 16;
export const CARD_HEADER_GAP_CSS_PX = 4;
/** The hairline border of cards, outline buttons and toggles. */
export const HAIRLINE_CSS_PX = 1;
/** button.tsx size `lg` (h-9, gap-1.5, px-2.5, 16px icons): the web's largest control height. */
export const BUTTON_HEIGHT_CSS_PX = 36;
export const BUTTON_GAP_CSS_PX = 6;
export const BUTTON_PADDING_X_CSS_PX = 10;
export const ICON_CSS_PX = 16;
/** Gap between the controls of a row (`gap-2`). */
export const CONTROL_GAP_CSS_PX = 8;
/** badge.tsx: h-5, px-2. */
export const BADGE_HEIGHT_CSS_PX = 20;
/** Disabled controls, as the web `disabled:opacity-50`. */
const DISABLED_ALPHA = 0.5;
/** `primary/80`, `destructive/90`, the 5 % foreground mix of `secondary`, `input/30`. */
const DEFAULT_HOVER_ALPHA = 0.8;
const DESTRUCTIVE_HOVER_ALPHA = 0.9;
const SECONDARY_HOVER_MIX = 0.05;
const DARK_OUTLINE_ALPHA = 0.3;
const DARK_OUTLINE_HOVER_ALPHA = 0.5;
const DARK_GHOST_HOVER_ALPHA = 0.5;

const TOKENS = {
	background: "--background",
	card: "--card",
	cardForeground: "--card-foreground",
	foreground: "--foreground",
	muted: "--muted",
	mutedForeground: "--muted-foreground",
	secondary: "--secondary",
	secondaryForeground: "--secondary-foreground",
	accent: "--accent",
	primary: "--primary",
	primaryForeground: "--primary-foreground",
	border: "--border",
	input: "--input",
	ring: "--ring",
	destructive: "--destructive",
	destructiveForeground: "--destructive-foreground",
} as const;

type ColorRole = keyof typeof TOKENS;
export type VrThemeToken = (typeof TOKENS)[ColorRole];

/** DESIGN.md frontmatter, light and dark. */
export const MAYU_LIGHT: Record<VrThemeToken, string> = {
	"--background": "#F2F7F8",
	"--card": "#FFFFFF",
	"--card-foreground": "#0A2530",
	"--foreground": "#0A2530",
	"--muted": "#E4EFF1",
	"--muted-foreground": "#4D6B74",
	"--secondary": "#E4EFF1",
	"--secondary-foreground": "#0A2530",
	"--accent": "#D5E8EC",
	"--primary": "#0B6E78",
	"--primary-foreground": "#FFFFFF",
	"--border": "#0A253021",
	"--input": "#0A253029",
	"--ring": "#0B6E78",
	"--destructive": "#C92A22",
	"--destructive-foreground": "#FFFFFF",
};

export const MAYU_DARK: Record<VrThemeToken, string> = {
	"--background": "#06181F",
	"--card": "#0B252F",
	"--card-foreground": "#E4F3F4",
	"--foreground": "#E4F3F4",
	"--muted": "#10303C",
	"--muted-foreground": "#8EB2BA",
	"--secondary": "#10303C",
	"--secondary-foreground": "#E4F3F4",
	"--accent": "#15394A",
	"--primary": "#34C6C2",
	"--primary-foreground": "#04161B",
	"--border": "#E4F3F41F",
	"--input": "#E4F3F42E",
	"--ring": "#6FE0DC",
	"--destructive": "#FF5148",
	"--destructive-foreground": "#06181F",
};

export interface VrTheme {
	colors: Record<ColorRole, string>;
	dark: boolean;
	fontSans: string;
	fontMono: string;
	radiusPx: { inner: number; control: number; surface: number; full: number };
	hairlinePx: number;
}

export function vrTheme(readToken: (token: VrThemeToken) => string): VrTheme {
	const color = (token: VrThemeToken) => readToken(token) || MAYU_LIGHT[token];
	const colors: Record<ColorRole, string> = {
		background: color(TOKENS.background),
		card: color(TOKENS.card),
		cardForeground: color(TOKENS.cardForeground),
		foreground: color(TOKENS.foreground),
		muted: color(TOKENS.muted),
		mutedForeground: color(TOKENS.mutedForeground),
		secondary: color(TOKENS.secondary),
		secondaryForeground: color(TOKENS.secondaryForeground),
		accent: color(TOKENS.accent),
		primary: color(TOKENS.primary),
		primaryForeground: color(TOKENS.primaryForeground),
		border: color(TOKENS.border),
		input: color(TOKENS.input),
		ring: color(TOKENS.ring),
		destructive: color(TOKENS.destructive),
		destructiveForeground: color(TOKENS.destructiveForeground),
	};
	const background = parseHex(colors.background);
	return {
		colors,
		dark: background
			? (background.red + background.green + background.blue) / 3 < 128
			: false,
		fontSans: '"Archivo Variable", Archivo, system-ui, sans-serif',
		fontMono:
			'"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace',
		radiusPx: {
			inner: texturePx(MAYU_RADIUS_CSS_PX.inner),
			control: texturePx(MAYU_RADIUS_CSS_PX.control),
			surface: texturePx(MAYU_RADIUS_CSS_PX.surface),
			full: texturePx(MAYU_RADIUS_CSS_PX.full),
		},
		hairlinePx: texturePx(HAIRLINE_CSS_PX),
	};
}

/** The page's current theme (light or dark), or the DESIGN.md light values without a page. */
export function readVrTheme(): VrTheme {
	if (typeof document === "undefined") return vrTheme(() => "");
	const styles = getComputedStyle(document.documentElement);
	return vrTheme((name) => styles.getPropertyValue(name).trim());
}

interface Rgba {
	red: number;
	green: number;
	blue: number;
	alpha: number;
}

function parseHex(color: string): Rgba | null {
	const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color.trim());
	if (!match?.[1]) return null;
	const value = Number.parseInt(match[1], 16);
	return {
		red: (value >> 16) & 0xff,
		green: (value >> 8) & 0xff,
		blue: value & 0xff,
		alpha: match[2] ? Number.parseInt(match[2], 16) / 255 : 1,
	};
}

/** `color/NN` of Tailwind: the colour at `alpha` times its own alpha. */
export function colorWithAlpha(color: string, alpha: number): string {
	const rgba = parseHex(color);
	if (!rgba) return color;
	return `rgba(${rgba.red}, ${rgba.green}, ${rgba.blue}, ${rgba.alpha * alpha})`;
}

/** `color-mix(base, other t)` in sRGB (the web mixes in OKLCH; the 5 % hover reads the same). */
export function mixColors(base: string, other: string, amount: number): string {
	const from = parseHex(base);
	const to = parseHex(other);
	if (!from || !to) return base;
	const mix = (a: number, b: number) => Math.round(a + (b - a) * amount);
	return `rgb(${mix(from.red, to.red)}, ${mix(from.green, to.green)}, ${mix(from.blue, to.blue)})`;
}

export type VrTextRole =
	| "heading"
	| "body"
	| "label"
	| "data"
	| "button"
	| "toggle";

export interface VrTextStyle {
	fontFamily: string;
	fontWeight: string;
	fontStretch: "normal" | "expanded";
	/** Texture px. */
	fontSizePx: number;
	lineHeightPx: number;
	letterSpacingPx: number;
	uppercase: boolean;
	color: string;
}

/** globals.css `type-*` utilities, the button text and the toggle text, at the VR scale. */
export function vrTextStyle(theme: VrTheme, role: VrTextRole): VrTextStyle {
	const { colors } = theme;
	const style = (
		fontFamily: string,
		fontWeight: string,
		sizeCssPx: number,
		lineHeight: number,
		trackingEm: number,
		uppercase: boolean,
		color: string,
		fontStretch: VrTextStyle["fontStretch"] = "normal",
	): VrTextStyle => ({
		fontFamily,
		fontWeight,
		fontStretch,
		fontSizePx: texturePx(sizeCssPx),
		lineHeightPx: texturePx(sizeCssPx * lineHeight),
		letterSpacingPx: texturePx(sizeCssPx * trackingEm),
		uppercase,
		color,
	});
	const styles: Record<VrTextRole, () => VrTextStyle> = {
		heading: () =>
			style(
				theme.fontSans,
				"800",
				17,
				1.2,
				0.005,
				true,
				colors.cardForeground,
				"expanded",
			),
		body: () =>
			style(theme.fontSans, "400", 15, 1.6, 0, false, colors.cardForeground),
		label: () =>
			style(theme.fontMono, "600", 11, 1.4, 0.1, true, colors.mutedForeground),
		data: () =>
			style(theme.fontMono, "500", 13, 1.45, 0, false, colors.cardForeground),
		button: () =>
			style(theme.fontSans, "600", 12, 1.4, 0.06, true, colors.cardForeground),
		toggle: () =>
			style(theme.fontSans, "500", 12, 1.4, 0, false, colors.foreground),
	};
	return styles[role]();
}

export type VrButtonVariant =
	| "default"
	| "secondary"
	| "outline"
	| "ghost"
	| "destructive";

export interface VrControlState {
	hovered: boolean;
	pressed: boolean;
	disabled: boolean;
	focused: boolean;
}

export interface VrControlStyle {
	background: string;
	color: string;
	borderColor: string;
	alpha: number;
}

/** button.tsx variants. The web's pressed state only nudges the button 1px, so it reads as hover. */
export function vrButtonStyle(
	theme: VrTheme,
	variant: VrButtonVariant,
	state: VrControlState,
): VrControlStyle {
	const { colors, dark } = theme;
	const hot = state.hovered || state.pressed;
	const styles: Record<VrButtonVariant, () => Omit<VrControlStyle, "alpha">> = {
		default: () => ({
			background: hot
				? colorWithAlpha(colors.primary, DEFAULT_HOVER_ALPHA)
				: colors.primary,
			color: colors.primaryForeground,
			borderColor: "transparent",
		}),
		secondary: () => ({
			background: hot
				? mixColors(colors.secondary, colors.foreground, SECONDARY_HOVER_MIX)
				: colors.secondary,
			color: colors.secondaryForeground,
			borderColor: "transparent",
		}),
		outline: () => ({
			background: dark
				? colorWithAlpha(
						colors.input,
						hot ? DARK_OUTLINE_HOVER_ALPHA : DARK_OUTLINE_ALPHA,
					)
				: hot
					? colors.muted
					: colors.background,
			color: colors.foreground,
			borderColor: dark ? colors.input : colors.border,
		}),
		ghost: () => ({
			background: hot
				? dark
					? colorWithAlpha(colors.muted, DARK_GHOST_HOVER_ALPHA)
					: colors.muted
				: "transparent",
			color: colors.foreground,
			borderColor: "transparent",
		}),
		destructive: () => ({
			background: hot
				? colorWithAlpha(colors.destructive, DESTRUCTIVE_HOVER_ALPHA)
				: colors.destructive,
			color: colors.destructiveForeground,
			borderColor: "transparent",
		}),
	};
	const style = styles[variant]();
	return {
		...style,
		borderColor: state.focused ? colors.ring : style.borderColor,
		alpha: state.disabled ? DISABLED_ALPHA : 1,
	};
}

/** toggle.tsx `outline` (segmented choices: tools, views, layers): `muted` when on or hovered. */
export function vrToggleStyle(
	theme: VrTheme,
	state: VrControlState & { on: boolean },
): VrControlStyle {
	const { colors } = theme;
	return {
		background:
			state.on || state.hovered || state.pressed ? colors.muted : "transparent",
		color: colors.foreground,
		borderColor: state.focused ? colors.ring : colors.input,
		alpha: state.disabled ? DISABLED_ALPHA : 1,
	};
}

/** badge.tsx (type-label text). */
export function vrBadgeStyle(
	theme: VrTheme,
	variant: "default" | "secondary",
): { background: string; color: string } {
	const { colors } = theme;
	return variant === "default"
		? { background: colors.primary, color: colors.primaryForeground }
		: { background: colors.secondary, color: colors.secondaryForeground };
}
