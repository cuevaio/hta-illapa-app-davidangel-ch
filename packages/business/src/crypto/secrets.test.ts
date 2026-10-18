import { describe, expect, it } from "vitest";

import { verifySecret } from "./index";

const secret = "configured-run-secret";

describe("run secret verification", () => {
	it("accepts matching nonempty secrets", () => {
		expect(verifySecret(secret, secret)).toBe(true);
	});

	it.each([null, undefined, "", "wrong", `${secret}x`, secret.slice(1)])(
		"rejects a missing or incorrect provided secret (%s)",
		(providedSecret) => {
			expect(verifySecret(providedSecret, secret)).toBe(false);
		},
	);

	it.each([null, undefined, ""])(
		"fails closed for missing configuration (%s)",
		(expectedSecret) => {
			for (const providedSecret of [null, undefined, "", secret]) {
				expect(verifySecret(providedSecret, expectedSecret)).toBe(false);
			}
		},
	);

	it("compares UTF-8 secrets of different byte lengths safely", () => {
		expect(verifySecret("á", "á")).toBe(true);
		expect(verifySecret("á", "a")).toBe(false);
	});
});
