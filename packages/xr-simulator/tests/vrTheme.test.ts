import { describe, expect, it } from "vitest";
import {
	MAYU_DARK,
	MAYU_LIGHT,
	vrButtonStyle,
	vrTextStyle,
	vrTheme,
} from "../src/ui/vr/theme";

const fromTokens = (tokens: Record<string, string>) => (token: string) =>
	tokens[token] ?? "";

describe("vrTheme (Mayu tokens for the VR menus, S9)", () => {
	it("defaults to the DESIGN.md light values when the page has no tokens (standalone page)", () => {
		const theme = vrTheme(() => "");
		expect(theme).toMatchObject({
			surface: MAYU_LIGHT["--card"],
			ink: MAYU_LIGHT["--foreground"],
			inkMuted: MAYU_LIGHT["--muted-foreground"],
			control: MAYU_LIGHT["--secondary"],
			action: MAYU_LIGHT["--primary"],
			actionInk: MAYU_LIGHT["--primary-foreground"],
			line: MAYU_LIGHT["--border"],
			error: MAYU_LIGHT["--destructive"],
		});
		expect(MAYU_LIGHT["--card"]).toBe("#FFFFFF");
		expect(MAYU_LIGHT["--primary"]).toBe("#0B6E78");
	});

	it("follows the page's live tokens, e.g. dark mode", () => {
		const theme = vrTheme(
			fromTokens({
				"--card": MAYU_DARK["--card"],
				"--foreground": MAYU_DARK["--foreground"],
				"--primary": MAYU_DARK["--primary"],
			}),
		);
		expect(theme.surface).toBe("#0B252F");
		expect(theme.ink).toBe("#E4F3F4");
		expect(theme.action).toBe("#34C6C2");
		expect(theme.control).toBe(MAYU_LIGHT["--secondary"]);
	});

	it("uses Archivo for text and JetBrains Mono for labels and data, with the Mayu radii", () => {
		const theme = vrTheme(() => "");
		expect(theme.fontSans).toMatch(/^"Archivo Variable"/);
		expect(theme.fontMono).toMatch(/^"JetBrains Mono Variable"/);
		expect(theme.controlRadiusPx).toBeGreaterThan(theme.innerRadiusPx);
		expect(theme.surfaceRadiusPx).toBeGreaterThan(theme.controlRadiusPx);
	});
});

describe("vrButtonStyle", () => {
	const theme = vrTheme(() => "");

	it("is a secondary button at rest and the primary fill when on", () => {
		expect(vrButtonStyle(theme, { active: false, disabled: false })).toEqual({
			background: theme.control,
			color: theme.ink,
			alpha: 1,
		});
		expect(vrButtonStyle(theme, { active: true, disabled: false })).toEqual({
			background: theme.action,
			color: theme.actionInk,
			alpha: 1,
		});
	});

	it("dims to half like the web disabled state", () => {
		expect(vrButtonStyle(theme, { active: false, disabled: true }).alpha).toBe(
			0.5,
		);
	});
});

describe("vrTextStyle", () => {
	const theme = vrTheme(() => "");

	it("maps the web type roles: uppercase heading and label, sentence-case body", () => {
		expect(vrTextStyle(theme, "heading")).toMatchObject({
			fontFamily: theme.fontSans,
			fontWeight: "800",
			color: theme.ink,
			uppercase: true,
		});
		expect(vrTextStyle(theme, "label")).toMatchObject({
			fontFamily: theme.fontMono,
			fontWeight: "600",
			color: theme.inkMuted,
			uppercase: true,
		});
		expect(vrTextStyle(theme, "body")).toMatchObject({
			fontFamily: theme.fontSans,
			fontWeight: "400",
			color: theme.ink,
			uppercase: false,
		});
		expect(vrTextStyle(theme, "data").fontFamily).toBe(theme.fontMono);
		expect(vrTextStyle(theme, "button")).toMatchObject({
			fontWeight: "600",
			uppercase: true,
		});
	});

	it("keeps headset-legible sizes (texture px of a 2000 px/m panel)", () => {
		for (const role of ["heading", "body", "label", "data", "button"] as const)
			expect(vrTextStyle(theme, role).fontSize).toBeGreaterThanOrEqual(24);
	});
});
