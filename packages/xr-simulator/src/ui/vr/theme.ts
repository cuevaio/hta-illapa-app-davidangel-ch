/**
 * The web design system "Mayu" (docs/DESIGN.md, tokens in packages/ui/src/styles/globals.css)
 * for the VR menus (S9). Babylon GUI cannot read CSS variables, so the page's live tokens are
 * read once per menu and fall back to the DESIGN.md light values on a page without them.
 */

export const VR_THEME_TOKENS = [
	"--card",
	"--foreground",
	"--muted-foreground",
	"--secondary",
	"--primary",
	"--primary-foreground",
	"--border",
	"--destructive",
] as const;

export type VrThemeToken = (typeof VR_THEME_TOKENS)[number];

export const MAYU_LIGHT: Record<VrThemeToken, string> = {
	"--card": "#FFFFFF",
	"--foreground": "#0A2530",
	"--muted-foreground": "#4D6B74",
	"--secondary": "#E4EFF1",
	"--primary": "#0B6E78",
	"--primary-foreground": "#FFFFFF",
	"--border": "#0A253021",
	"--destructive": "#C92A22",
};

export const MAYU_DARK: Record<VrThemeToken, string> = {
	"--card": "#0B252F",
	"--foreground": "#E4F3F4",
	"--muted-foreground": "#8EB2BA",
	"--secondary": "#10303C",
	"--primary": "#34C6C2",
	"--primary-foreground": "#04161B",
	"--border": "#E4F3F41F",
	"--destructive": "#FF5148",
};

/**
 * Texture px per web CSS px: a VR menu texture is 2000 px per metre, read at arm's length, so
 * the web radii and hairlines scale up to keep their proportion to the (larger) VR controls.
 */
const VR_PX_PER_CSS_PX = 2.5;
const RADIUS_SM_CSS_PX = 6;
const RADIUS_MD_CSS_PX = 10;
const RADIUS_LG_CSS_PX = 14;
const HAIRLINE_CSS_PX = 1;
/** Disabled controls, as the web `disabled:opacity-50`. */
const DISABLED_ALPHA = 0.5;

export interface VrTheme {
	surface: string;
	ink: string;
	inkMuted: string;
	control: string;
	action: string;
	actionInk: string;
	line: string;
	error: string;
	fontSans: string;
	fontMono: string;
	innerRadiusPx: number;
	controlRadiusPx: number;
	surfaceRadiusPx: number;
	hairlinePx: number;
}

export function vrTheme(readToken: (token: VrThemeToken) => string): VrTheme {
	const token = (name: VrThemeToken) => readToken(name) || MAYU_LIGHT[name];
	return {
		surface: token("--card"),
		ink: token("--foreground"),
		inkMuted: token("--muted-foreground"),
		control: token("--secondary"),
		action: token("--primary"),
		actionInk: token("--primary-foreground"),
		line: token("--border"),
		error: token("--destructive"),
		fontSans: '"Archivo Variable", Archivo, system-ui, sans-serif',
		fontMono:
			'"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace',
		innerRadiusPx: RADIUS_SM_CSS_PX * VR_PX_PER_CSS_PX,
		controlRadiusPx: RADIUS_MD_CSS_PX * VR_PX_PER_CSS_PX,
		surfaceRadiusPx: RADIUS_LG_CSS_PX * VR_PX_PER_CSS_PX,
		hairlinePx: HAIRLINE_CSS_PX * VR_PX_PER_CSS_PX,
	};
}

/** The page's current theme (light or dark), or the DESIGN.md light values without a page. */
export function readVrTheme(): VrTheme {
	if (typeof document === "undefined") return vrTheme(() => "");
	const styles = getComputedStyle(document.documentElement);
	return vrTheme((name) => styles.getPropertyValue(name).trim());
}

export interface VrButtonStyle {
	background: string;
	color: string;
	alpha: number;
}

/** A Mayu `secondary` button at rest; switched on, the `primary` fill (a pressed toggle). */
export function vrButtonStyle(
	theme: VrTheme,
	state: { active: boolean; disabled: boolean },
): VrButtonStyle {
	return {
		background: state.active ? theme.action : theme.control,
		color: state.active ? theme.actionInk : theme.ink,
		alpha: state.disabled ? DISABLED_ALPHA : 1,
	};
}

export type VrTextRole = "heading" | "body" | "label" | "data" | "button";

export interface VrTextStyle {
	fontFamily: string;
	fontWeight: string;
	/** Texture px. */
	fontSize: number;
	color: string;
	uppercase: boolean;
}

/** The web type roles (`type-heading`, `type-body`, `type-label`, `type-data`, buttons) at headset sizes. */
export function vrTextStyle(theme: VrTheme, role: VrTextRole): VrTextStyle {
	const styles: Record<VrTextRole, VrTextStyle> = {
		heading: {
			fontFamily: theme.fontSans,
			fontWeight: "800",
			fontSize: 40,
			color: theme.ink,
			uppercase: true,
		},
		body: {
			fontFamily: theme.fontSans,
			fontWeight: "400",
			fontSize: 30,
			color: theme.ink,
			uppercase: false,
		},
		label: {
			fontFamily: theme.fontMono,
			fontWeight: "600",
			fontSize: 24,
			color: theme.inkMuted,
			uppercase: true,
		},
		data: {
			fontFamily: theme.fontMono,
			fontWeight: "500",
			fontSize: 28,
			color: theme.ink,
			uppercase: false,
		},
		button: {
			fontFamily: theme.fontSans,
			fontWeight: "600",
			fontSize: 28,
			color: theme.ink,
			uppercase: true,
		},
	};
	return styles[role];
}
