import { evaluateVehicleReview } from "@hack-the-andes-project/business/fleet/review-trips";
import { fleetPlanningProcedure } from "../fleet-planning-procedure";
import {
	routeReviewInputSchema,
	routeReviewSchema,
} from "../route-review-schemas";

export const routeReviewRouter = {
	evaluate: fleetPlanningProcedure
		.input(routeReviewInputSchema)
		.output(routeReviewSchema)
		.handler(({ context, input }) => evaluateVehicleReview(context, input)),
};
