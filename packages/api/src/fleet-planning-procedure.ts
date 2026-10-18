import { FleetPlanningError } from "@hack-the-andes-project/business/fleet/review-trips";
import { ORPCError } from "@orpc/server";
import { organizationProcedure } from "./index";

export const fleetPlanningProcedure = organizationProcedure.use(
	async ({ next }) => {
		try {
			return await next();
		} catch (error) {
			if (error instanceof FleetPlanningError)
				throw new ORPCError(error.code, { message: error.message });
			throw error;
		}
	},
);
