import { describe, expect, it } from "vitest";

import { createOriginMatcher, parseAllowedOrigins } from "./origins";
import { hashPassword, verifyPassword } from "./password";

describe("hashPassword", () => {
	it("verifies the original password and rejects any other", async () => {
		const hash = await hashPassword("correct horse battery staple");

		expect(
			await verifyPassword({ hash, password: "correct horse battery staple" }),
		).toBe(true);
		expect(await verifyPassword({ hash, password: "wrong password" })).toBe(
			false,
		);
	});

	it("rejects hashes in an unknown format", async () => {
		expect(
			await verifyPassword({ hash: "scrypt:abc", password: "anything" }),
		).toBe(false);
	});
});

describe("parseAllowedOrigins", () => {
	it("splits, trims and drops empty entries", () => {
		expect(
			parseAllowedOrigins(" http://localhost:3001 ,https://app.example.com,, "),
		).toEqual(["http://localhost:3001", "https://app.example.com"]);
	});
});

describe("createOriginMatcher", () => {
	const isAllowedOrigin = createOriginMatcher([
		"http://localhost:3001",
		"https://illapa-app-*-team.vercel.app",
	]);

	it("matches exact origins only", () => {
		expect(isAllowedOrigin("http://localhost:3001")).toBe(true);
		expect(isAllowedOrigin("http://localhost:30011")).toBe(false);
		expect(isAllowedOrigin("https://localhost:3001")).toBe(false);
	});

	it("lets a wildcard match within a single host label", () => {
		expect(isAllowedOrigin("https://illapa-app-git-main-team.vercel.app")).toBe(
			true,
		);
		expect(
			isAllowedOrigin("https://illapa-app-x.evil.com-team.vercel.app"),
		).toBe(false);
		expect(
			isAllowedOrigin("https://illapa-app-x-team.vercel.app.evil.com"),
		).toBe(false);
	});
});
