import { describe, expect, it } from "vitest";
import {
	BUTTON_HEIGHT_CSS_PX,
	CARD_SPACING_CSS_PX,
	colorWithAlpha,
	MAYU_DARK,
	MAYU_RADIUS_CSS_PX,
	metresOf,
	mixColors,
	texturePx,
	VR_METRES_PER_CSS_PX,
	VR_TEXTURE_PX_PER_CSS_PX,
	vrBadgeStyle,
	vrButtonStyle,
	vrTextStyle,
	vrTheme,
	vrToggleStyle,
} from "../src/ui/vr/theme";

const light = vrTheme(() => "");
const dark = vrTheme((token) => MAYU_DARK[token]);
const REST = {
	hovered: false,
	pressed: false,
	disabled: false,
	focused: false,
};

describe("VR scale: one CSS px → texture px and metres factor (S12)", () => {
	it("maps every web length through the same factors", () => {
		expect(texturePx(CARD_SPACING_CSS_PX)).toBe(
			CARD_SPACING_CSS_PX * VR_TEXTURE_PX_PER_CSS_PX,
		);
		expect(metresOf(400)).toBeCloseTo(400 * VR_METRES_PER_CSS_PX, 9);
	});

	it("keeps the 1px hairline at least one Quest 3 eye pixel at 1 m", () => {
		const QUEST3_PX_PER_DEGREE = 25;
		const degrees = (Math.atan(metresOf(1)) * 180) / Math.PI;
		expect(degrees * QUEST3_PX_PER_DEGREE).toBeGreaterThanOrEqual(1);
	});

	it("keeps body text and button targets legible and pressable in a headset", () => {
		expect(metresOf(15)).toBeGreaterThanOrEqual(0.015);
		expect(metresOf(BUTTON_HEIGHT_CSS_PX)).toBeGreaterThanOrEqual(0.04);
	});
});

describe("vrTheme (Mayu tokens)", () => {
	it("defaults to the DESIGN.md light values without page tokens", () => {
		expect(light.colors.card).toBe("#FFFFFF");
		expect(light.colors.primary).toBe("#0B6E78");
		expect(light.colors.border).toBe("#0A253021");
		expect(light.dark).toBe(false);
	});

	it("follows the page's tokens, e.g. dark mode", () => {
		expect(dark.colors.card).toBe(MAYU_DARK["--card"]);
		expect(dark.colors.ring).toBe("#6FE0DC");
		expect(dark.dark).toBe(true);
	});

	it("has the radius by role: card 14, controls 10, inner items 6, pills full", () => {
		expect(MAYU_RADIUS_CSS_PX).toEqual({
			inner: 6,
			control: 10,
			surface: 14,
			full: 9999,
		});
		expect(light.radiusPx.surface).toBe(texturePx(14));
		expect(light.radiusPx.control).toBe(texturePx(10));
		expect(light.radiusPx.inner).toBe(texturePx(6));
		expect(light.hairlinePx).toBe(texturePx(1));
	});
});

describe("vrTextStyle (globals.css type-* utilities)", () => {
	it("heading: Archivo Expanded 800 uppercase, 17px, 1.2, 0.005em", () => {
		expect(vrTextStyle(light, "heading")).toEqual({
			fontFamily: light.fontSans,
			fontWeight: "800",
			fontStretch: "expanded",
			fontSizePx: texturePx(17),
			lineHeightPx: texturePx(17 * 1.2),
			letterSpacingPx: texturePx(17 * 0.005),
			uppercase: true,
			color: light.colors.cardForeground,
		});
	});

	it("body Archivo 400 15px; label JetBrains Mono 600 11px uppercase 0.1em; data Mono 500 13px", () => {
		expect(vrTextStyle(light, "body")).toMatchObject({
			fontFamily: light.fontSans,
			fontWeight: "400",
			fontStretch: "normal",
			fontSizePx: texturePx(15),
			lineHeightPx: texturePx(15 * 1.6),
			letterSpacingPx: 0,
			uppercase: false,
		});
		expect(vrTextStyle(light, "label")).toMatchObject({
			fontFamily: light.fontMono,
			fontWeight: "600",
			fontSizePx: texturePx(11),
			letterSpacingPx: texturePx(11 * 0.1),
			uppercase: true,
			color: light.colors.mutedForeground,
		});
		expect(vrTextStyle(light, "data")).toMatchObject({
			fontFamily: light.fontMono,
			fontWeight: "500",
			fontSizePx: texturePx(13),
		});
	});

	it("button Archivo 600 12px uppercase 0.06em; toggle Archivo 500 12px", () => {
		expect(vrTextStyle(light, "button")).toMatchObject({
			fontFamily: light.fontSans,
			fontWeight: "600",
			fontSizePx: texturePx(12),
			letterSpacingPx: texturePx(12 * 0.06),
			uppercase: true,
		});
		expect(vrTextStyle(light, "toggle")).toMatchObject({
			fontWeight: "500",
			fontSizePx: texturePx(12),
			uppercase: false,
		});
	});

	it("the families start with the fonts the web loads", () => {
		expect(light.fontSans).toMatch(/^"Archivo Variable"/);
		expect(light.fontMono).toMatch(/^"JetBrains Mono Variable"/);
	});
});

describe("vrButtonStyle (button.tsx variants)", () => {
	const c = light.colors;

	it("default: primary with its ink, primary/80 on hover", () => {
		expect(vrButtonStyle(light, "default", REST)).toEqual({
			background: c.primary,
			color: c.primaryForeground,
			borderColor: "transparent",
			alpha: 1,
		});
		expect(
			vrButtonStyle(light, "default", { ...REST, hovered: true }).background,
		).toBe(colorWithAlpha(c.primary, 0.8));
	});

	it("secondary: secondary fill, 5 % foreground mix on hover", () => {
		expect(vrButtonStyle(light, "secondary", REST)).toMatchObject({
			background: c.secondary,
			color: c.secondaryForeground,
		});
		expect(
			vrButtonStyle(light, "secondary", { ...REST, hovered: true }).background,
		).toBe(mixColors(c.secondary, c.foreground, 0.05));
	});

	it("outline: background with a border hairline (input in dark), muted on hover", () => {
		expect(vrButtonStyle(light, "outline", REST)).toMatchObject({
			background: c.background,
			borderColor: c.border,
		});
		expect(
			vrButtonStyle(light, "outline", { ...REST, hovered: true }).background,
		).toBe(c.muted);
		expect(vrButtonStyle(dark, "outline", REST)).toMatchObject({
			background: colorWithAlpha(dark.colors.input, 0.3),
			borderColor: dark.colors.input,
		});
	});

	it("ghost: transparent, muted on hover; destructive: destructive, /90 on hover", () => {
		expect(vrButtonStyle(light, "ghost", REST).background).toBe("transparent");
		expect(
			vrButtonStyle(light, "ghost", { ...REST, hovered: true }).background,
		).toBe(c.muted);
		expect(vrButtonStyle(light, "destructive", REST)).toMatchObject({
			background: c.destructive,
			color: c.destructiveForeground,
		});
		expect(
			vrButtonStyle(light, "destructive", { ...REST, hovered: true })
				.background,
		).toBe(colorWithAlpha(c.destructive, 0.9));
	});

	it("pressed reads as hover, disabled is 50 %, focus draws the ring", () => {
		expect(
			vrButtonStyle(light, "secondary", { ...REST, pressed: true }),
		).toEqual(vrButtonStyle(light, "secondary", { ...REST, hovered: true }));
		expect(
			vrButtonStyle(light, "default", { ...REST, disabled: true }).alpha,
		).toBe(0.5);
		expect(
			vrButtonStyle(light, "secondary", { ...REST, focused: true }).borderColor,
		).toBe(c.ring);
	});
});

describe("vrToggleStyle (toggle.tsx outline) and vrBadgeStyle (badge.tsx)", () => {
	const c = light.colors;

	it("toggle: transparent with an input border, muted when on or hovered", () => {
		expect(vrToggleStyle(light, { ...REST, on: false })).toEqual({
			background: "transparent",
			color: c.foreground,
			borderColor: c.input,
			alpha: 1,
		});
		expect(vrToggleStyle(light, { ...REST, on: true }).background).toBe(
			c.muted,
		);
		expect(
			vrToggleStyle(light, { ...REST, on: false, hovered: true }).background,
		).toBe(c.muted);
	});

	it("badge: secondary or default fill with its ink", () => {
		expect(vrBadgeStyle(light, "secondary")).toEqual({
			background: c.secondary,
			color: c.secondaryForeground,
		});
		expect(vrBadgeStyle(light, "default")).toEqual({
			background: c.primary,
			color: c.primaryForeground,
		});
	});
});

describe("colour helpers", () => {
	it("applies alpha to #rgb(a) hex and mixes two hex colours", () => {
		expect(colorWithAlpha("#0B6E78", 0.8)).toBe("rgba(11, 110, 120, 0.8)");
		expect(colorWithAlpha("#E4F3F42E", 0.3)).toBe(
			`rgba(228, 243, 244, ${(0x2e / 255) * 0.3})`,
		);
		expect(mixColors("#000000", "#FFFFFF", 0.5)).toBe("rgb(128, 128, 128)");
	});

	it("leaves colours it cannot parse untouched", () => {
		expect(colorWithAlpha("oklch(0.5 0.1 200)", 0.5)).toBe(
			"oklch(0.5 0.1 200)",
		);
	});
});
