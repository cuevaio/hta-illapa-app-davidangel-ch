import { createHash, timingSafeEqual } from "node:crypto";

export function verifySecret(
	providedSecret: string | null | undefined,
	expectedSecret: string | null | undefined,
) {
	const providedDigest = createHash("sha256")
		.update(providedSecret ?? "")
		.digest();
	const expectedDigest = createHash("sha256")
		.update(expectedSecret ?? "")
		.digest();
	return (
		timingSafeEqual(providedDigest, expectedDigest) &&
		Boolean(providedSecret) &&
		Boolean(expectedSecret)
	);
}
