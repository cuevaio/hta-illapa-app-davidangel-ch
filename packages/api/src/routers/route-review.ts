import { evaluateVehicleReview } from "@hack-the-andes-project/business/fleet/review-trips";
import { isDepartureInReviewWindow } from "@hack-the-andes-project/business/route-review/trips";
import { ORPCError } from "@orpc/server";
import { ROUTE_REVIEW_DEPARTURE_INVALID_MESSAGE } from "../constants";
import { fleetPlanningProcedure } from "../fleet-planning-procedure";
import {
	routeReviewInputSchema,
	routeReviewSchema,
} from "../route-review-schemas";

export const routeReviewRouter = {
	evaluate: fleetPlanningProcedure
		.input(routeReviewInputSchema)
		.output(routeReviewSchema)
		.handler(({ context, input }) => {
			if (!isDepartureInReviewWindow(input.departureAt, new Date()))
				throw new ORPCError("BAD_REQUEST", {
					message: ROUTE_REVIEW_DEPARTURE_INVALID_MESSAGE,
				});
			return evaluateVehicleReview(context, input);
		}),
};
