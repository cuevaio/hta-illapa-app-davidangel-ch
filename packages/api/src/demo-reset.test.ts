import { verifySecret } from "@hack-the-andes-project/business/crypto/index";
import { describe, expect, it } from "vitest";

const secret = "demo-reset-test-secret-long-enough-for-auth";

describe("demo reset secret", () => {
	it("accepts exactly the configured secret", () => {
		expect(verifySecret(secret, secret)).toBe(true);
	});

	it.each([undefined, "", "wrong", `${secret}x`, secret.slice(1)])(
		"rejects missing and incorrect secrets (%s)",
		(provided) => {
			expect(verifySecret(provided, secret)).toBe(false);
		},
	);

	it("fails closed with an empty configuration", () => {
		expect(verifySecret("", "")).toBe(false);
		expect(verifySecret(undefined, "")).toBe(false);
		expect(verifySecret(undefined, undefined)).toBe(false);
		expect(verifySecret(secret, undefined)).toBe(false);
	});
});
