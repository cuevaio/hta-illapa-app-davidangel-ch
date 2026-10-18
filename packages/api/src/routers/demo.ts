import { isDemoAccountEmail } from "@hack-the-andes-project/business/demo-account";
import {
	prepareDemo,
	restartFinishedDemo,
} from "@hack-the-andes-project/business/demo-seed";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { DEMO_PREPARE_FORBIDDEN_MESSAGE } from "../constants";
import { organizationProcedure } from "../index";

export const demoPrepareOutputSchema = z.object({
	vehicleCount: z.number().int().nonnegative(),
	tripCount: z.number().int().nonnegative(),
});

export const demoRouter = {
	prepare: organizationProcedure
		.input(z.void())
		.output(demoPrepareOutputSchema)
		.handler(async ({ context }) => {
			if (!isDemoAccountEmail(context.session.user.email))
				throw new ORPCError("FORBIDDEN", {
					message: DEMO_PREPARE_FORBIDDEN_MESSAGE,
				});
			return (await restartFinishedDemo(context)) ?? prepareDemo(context);
		}),
};
