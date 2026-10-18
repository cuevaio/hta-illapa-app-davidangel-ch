import { createHash, timingSafeEqual } from "node:crypto";
import {
	findDemoOrganizationId,
	type PrepareDemoInput,
	prepareDemo,
	wipeDemoFleet,
} from "@hack-the-andes-project/business/demo-seed";

export function verifyDemoResetSecret(
	providedSecret: string | undefined,
	expectedSecret: string | undefined,
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

export interface ResetDemoInput
	extends Omit<PrepareDemoInput, "organizationId"> {}

export async function resetDemo(input: ResetDemoInput) {
	const organizationId = await findDemoOrganizationId(input.db);
	if (!organizationId) return null;
	await wipeDemoFleet(input.db, organizationId);
	return prepareDemo({ ...input, organizationId });
}
