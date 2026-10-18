import { DEMO_TRIP_SCENARIOS } from "@hack-the-andes-project/business/constants";
import { TRIP_NOT_CANCELLABLE_MESSAGE } from "@hack-the-andes-project/business/fleet/constants";
import { createFleetTrip } from "@hack-the-andes-project/business/fleet/create-trip";
import { evaluateTrip } from "@hack-the-andes-project/business/fleet/evaluate-trip";
import { loadAlertableIncidents } from "@hack-the-andes-project/business/fleet/load-alertable-incidents";
import { planDemoTrip } from "@hack-the-andes-project/business/fleet/plan-demo-trip";
import { resolveObsoleteAlerts } from "@hack-the-andes-project/business/fleet/resolve-obsolete-alerts";
import {
	chooseReviewTripCandidate,
	getReviewTrip,
	listReviewTrips,
	planReviewTrip,
	reevaluateReviewTrip,
	startReviewTrip,
} from "@hack-the-andes-project/business/fleet/review-trips";
import { fetchRouteCandidates } from "@hack-the-andes-project/business/routing/osrm";
import {
	alert,
	TRIP_STATUSES,
	trip,
	vehicle,
} from "@hack-the-andes-project/db/schema/fleet";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, getColumns, inArray } from "drizzle-orm";
import { z } from "zod";
import {
	ALERT_STATUS_OPEN,
	DEMO_CLEAR_ROUTE_NOT_FOUND_MESSAGE,
	DEMO_HAZARD_ROUTE_NOT_FOUND_MESSAGE,
	DEMO_VEHICLE_REQUIRED_MESSAGE,
	ROUTING_FAILED_MESSAGE,
	TRIP_NOT_ACTIVE_MESSAGE,
	TRIP_NOT_FOUND_MESSAGE,
	TRIP_STATUS_ACTIVE,
	TRIP_STATUS_CANCELLED,
	TRIP_STATUS_COMPLETED,
	TRIP_STATUS_PLANNED,
	VEHICLE_POSITION_REQUIRED_MESSAGE,
} from "../constants";
import type { OrganizationContext } from "../context";
import { fleetPlanningProcedure } from "../fleet-planning-procedure";
import { organizationProcedure } from "../index";
import {
	plannedTripSchema,
	plannedTripSummarySchema,
	tripCandidateChoiceInputSchema,
	tripPlanInputSchema,
} from "../route-review-schemas";
import {
	entityIdInputSchema,
	fleetIdSchema,
	fleetNameSchema,
	latLngSchema,
	tripSchema,
	tripStatusSchema,
	tripSummarySchema,
} from "../schemas";

async function finishTrip(
	context: OrganizationContext,
	tripId: string,
	status: typeof TRIP_STATUS_CANCELLED | typeof TRIP_STATUS_COMPLETED,
) {
	await context.db
		.update(trip)
		.set({ status })
		.where(
			and(
				eq(trip.id, tripId),
				eq(trip.organizationId, context.organizationId),
				inArray(
					trip.status,
					status === TRIP_STATUS_CANCELLED
						? [TRIP_STATUS_ACTIVE, TRIP_STATUS_PLANNED]
						: [TRIP_STATUS_ACTIVE],
				),
			),
		);
	const finishedTrip = await context.db.query.trip.findFirst({
		columns: { id: true, status: true },
		where: { id: tripId, organizationId: context.organizationId },
	});
	if (!finishedTrip)
		throw new ORPCError("NOT_FOUND", { message: TRIP_NOT_FOUND_MESSAGE });
	if (finishedTrip.status !== status)
		throw new ORPCError("BAD_REQUEST", {
			message:
				status === TRIP_STATUS_CANCELLED
					? TRIP_NOT_CANCELLABLE_MESSAGE
					: TRIP_NOT_ACTIVE_MESSAGE,
		});
	await resolveObsoleteAlerts({
		db: context.db,
		organizationId: context.organizationId,
		now: new Date(),
	});
	context.log.set({
		fleet: { organizationId: context.organizationId, tripId, status },
	});
	return finishedTrip;
}

export const tripsRouter = {
	listPlanned: fleetPlanningProcedure
		.input(z.void())
		.output(z.array(plannedTripSummarySchema))
		.handler(({ context }) => listReviewTrips(context)),
	get: fleetPlanningProcedure
		.input(entityIdInputSchema)
		.output(plannedTripSchema)
		.handler(({ context, input }) => getReviewTrip(context, input.id)),
	plan: fleetPlanningProcedure
		.input(tripPlanInputSchema)
		.output(plannedTripSummarySchema)
		.handler(({ context, input }) => planReviewTrip(context, input)),
	chooseCandidate: fleetPlanningProcedure
		.input(tripCandidateChoiceInputSchema)
		.output(plannedTripSchema)
		.handler(({ context, input }) => chooseReviewTripCandidate(context, input)),
	reevaluate: fleetPlanningProcedure
		.input(entityIdInputSchema)
		.output(plannedTripSchema)
		.handler(({ context, input }) => reevaluateReviewTrip(context, input.id)),
	start: fleetPlanningProcedure
		.input(entityIdInputSchema)
		.output(plannedTripSchema)
		.handler(({ context, input }) => startReviewTrip(context, input.id)),
	list: organizationProcedure
		.input(z.object({ status: z.enum(TRIP_STATUSES).optional() }).default({}))
		.output(z.array(tripSummarySchema))
		.handler(async ({ context, input }) => {
			const trips = await context.db
				.select({
					...getColumns(trip),
					vehicleName: vehicle.name,
					openAlertCount: context.db.$count(
						alert,
						and(
							eq(alert.tripId, trip.id),
							eq(alert.organizationId, context.organizationId),
							eq(alert.status, ALERT_STATUS_OPEN),
						),
					),
				})
				.from(trip)
				.leftJoin(
					vehicle,
					and(
						eq(vehicle.id, trip.vehicleId),
						eq(vehicle.organizationId, context.organizationId),
					),
				)
				.where(
					and(
						eq(trip.organizationId, context.organizationId),
						input.status ? eq(trip.status, input.status) : undefined,
					),
				)
				.orderBy(desc(trip.createdAt), desc(trip.id));
			context.log.set({
				fleet: {
					organizationId: context.organizationId,
					tripsListed: trips.length,
					status: input.status,
				},
			});
			return trips;
		}),
	create: organizationProcedure
		.input(
			z.object({
				vehicleId: fleetIdSchema,
				name: fleetNameSchema,
				destination: latLngSchema,
				destinationName: fleetNameSchema.optional(),
			}),
		)
		.output(tripSchema)
		.handler(async ({ context, input }) => {
			const selectedVehicle = await context.db.query.vehicle.findFirst({
				where: { id: input.vehicleId, organizationId: context.organizationId },
			});
			if (
				!selectedVehicle ||
				selectedVehicle.lastLat === null ||
				selectedVehicle.lastLng === null
			) {
				throw new ORPCError("BAD_REQUEST", {
					message: VEHICLE_POSITION_REQUIRED_MESSAGE,
				});
			}
			context.log.set({
				fleet: {
					organizationId: context.organizationId,
					vehicleId: input.vehicleId,
				},
			});
			const routeCandidates = await fetchRouteCandidates({
				baseUrl: context.osrmBaseUrl,
				origin: { lat: selectedVehicle.lastLat, lng: selectedVehicle.lastLng },
				destination: input.destination,
			}).catch((cause: unknown) => {
				throw new ORPCError("BAD_REQUEST", {
					message: ROUTING_FAILED_MESSAGE,
					cause,
				});
			});
			const [primaryRoute] = routeCandidates;
			if (!primaryRoute)
				throw new ORPCError("BAD_REQUEST", { message: ROUTING_FAILED_MESSAGE });
			const { createdTrip, tripsCancelled } = await createFleetTrip({
				db: context.db,
				organizationId: context.organizationId,
				vehicleId: input.vehicleId,
				name: input.name,
				origin: { lat: selectedVehicle.lastLat, lng: selectedVehicle.lastLng },
				destination: input.destination,
				destinationName: input.destinationName,
				route: primaryRoute,
			});
			context.log.set({
				fleet: {
					tripId: createdTrip.id,
					tripsCancelled,
					routeDistanceM: primaryRoute.distanceM,
					routeDurationS: primaryRoute.durationS,
				},
			});
			const evaluation = await loadAlertableIncidents(context.db)
				.then((incidents) =>
					evaluateTrip({
						db: context.db,
						osrmBaseUrl: context.osrmBaseUrl,
						trip: createdTrip,
						vehicle: selectedVehicle,
						incidents,
						routeCandidates,
						now: createdTrip.createdAt,
						log: context.log,
					}),
				)
				.catch((error: unknown) => {
					// Driver errors carry SQL parameters, so only the error class is logged.
					context.log.set({
						fleet: {
							tripEvaluationError:
								error instanceof Error ? error.name : "Error",
						},
					});
					return null;
				});
			if (!evaluation || evaluation.skipped) return createdTrip;
			context.log.set({
				fleet: {
					alertsCreated: evaluation.alertsCreated,
					alertsUpdated: evaluation.alertsUpdated,
				},
			});
			return { ...createdTrip, lastEvaluatedAt: createdTrip.createdAt };
		}),
	planDemo: organizationProcedure
		.input(
			z.object({
				vehicleId: fleetIdSchema,
				scenario: z.enum(DEMO_TRIP_SCENARIOS),
			}),
		)
		.output(
			z.object({
				destination: latLngSchema,
				incidentTitle: z.string().nullable(),
			}),
		)
		.handler(async ({ context, input }) => {
			const selectedVehicle = await context.db.query.vehicle.findFirst({
				columns: { lastLat: true, lastLng: true },
				where: { id: input.vehicleId, organizationId: context.organizationId },
				with: { connection: { columns: { provider: true } } },
			});
			if (
				selectedVehicle?.connection?.provider !== "demo" ||
				selectedVehicle.lastLat === null ||
				selectedVehicle.lastLng === null
			) {
				throw new ORPCError("BAD_REQUEST", {
					message: DEMO_VEHICLE_REQUIRED_MESSAGE,
				});
			}
			context.log.set({
				fleet: {
					organizationId: context.organizationId,
					vehicleId: input.vehicleId,
					demoScenario: input.scenario,
				},
			});
			const plan = await planDemoTrip({
				osrmBaseUrl: context.osrmBaseUrl,
				origin: { lat: selectedVehicle.lastLat, lng: selectedVehicle.lastLng },
				scenario: input.scenario,
				incidents: await loadAlertableIncidents(context.db),
			}).catch((cause: unknown) => {
				context.log.set({
					fleet: {
						demoRouteError:
							cause instanceof Error ? cause.message : String(cause),
					},
				});
				throw new ORPCError("BAD_REQUEST", {
					message: ROUTING_FAILED_MESSAGE,
					cause,
				});
			});
			if (!plan)
				throw new ORPCError("BAD_REQUEST", {
					message:
						input.scenario === "hazard"
							? DEMO_HAZARD_ROUTE_NOT_FOUND_MESSAGE
							: DEMO_CLEAR_ROUTE_NOT_FOUND_MESSAGE,
				});
			context.log.set({ fleet: { demoIncidentId: plan.incident?.id } });
			return {
				destination: plan.destination,
				incidentTitle: plan.incident?.title ?? null,
			};
		}),
	cancel: organizationProcedure
		.input(entityIdInputSchema)
		.output(tripStatusSchema)
		.handler(({ context, input }) =>
			finishTrip(context, input.id, TRIP_STATUS_CANCELLED),
		),
	complete: organizationProcedure
		.input(entityIdInputSchema)
		.output(tripStatusSchema)
		.handler(({ context, input }) =>
			finishTrip(context, input.id, TRIP_STATUS_COMPLETED),
		),
};
