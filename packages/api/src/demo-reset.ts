import {
	findDemoOrganizationId,
	type PrepareDemoInput,
	prepareDemo,
	wipeDemoFleet,
} from "@hack-the-andes-project/business/demo-seed";

export interface ResetDemoInput
	extends Omit<PrepareDemoInput, "organizationId"> {}

export async function resetDemo(input: ResetDemoInput) {
	const organizationId = await findDemoOrganizationId(input.db);
	if (!organizationId) return null;
	await wipeDemoFleet(input.db, organizationId);
	return prepareDemo({ ...input, organizationId });
}
