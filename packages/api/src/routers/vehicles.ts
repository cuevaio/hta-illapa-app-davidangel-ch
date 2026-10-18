import {
	loadFleetVehicle,
	vehicleProfile,
} from "@hack-the-andes-project/business/fleet/review-trips";
import { vehicle } from "@hack-the-andes-project/db/schema/fleet";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { SINGLE_RESULT_LIMIT_ROWS, TRIP_STATUS_ACTIVE } from "../constants";
import { fleetPlanningProcedure } from "../fleet-planning-procedure";
import { organizationProcedure } from "../index";
import {
	profiledVehicleSummarySchema,
	vehicleCreateInputSchema,
	vehicleProfileUpdateInputSchema,
} from "../route-review-schemas";

export const vehiclesRouter = {
	create: fleetPlanningProcedure
		.input(vehicleCreateInputSchema)
		.output(profiledVehicleSummarySchema)
		.handler(async ({ context, input }) => {
			const now = new Date();
			const createdVehicle: typeof vehicle.$inferSelect = {
				...input,
				id: crypto.randomUUID(),
				organizationId: context.organizationId,
				connectionId: null,
				externalId: null,
				lastLat: null,
				lastLng: null,
				lastHeading: null,
				lastSpeedKmh: null,
				lastPositionAt: null,
				active: true,
				createdAt: now,
				updatedAt: now,
			};
			await context.db.insert(vehicle).values(createdVehicle);
			context.log.set({
				fleet: { vehicleId: createdVehicle.id, vehicleCreated: true },
			});
			return {
				...createdVehicle,
				provider: null,
				activeTrip: null,
				profile: vehicleProfile(createdVehicle),
			};
		}),
	updateProfile: fleetPlanningProcedure
		.input(vehicleProfileUpdateInputSchema)
		.output(profiledVehicleSummarySchema)
		.handler(async ({ context, input }) => {
			const selectedVehicle = await loadFleetVehicle(context, input.id);
			const { id, ...profile } = input;
			const updatedAt = new Date();
			await context.db
				.update(vehicle)
				.set({ ...profile, updatedAt })
				.where(
					and(
						eq(vehicle.id, id),
						eq(vehicle.organizationId, context.organizationId),
					),
				);
			const connection = selectedVehicle.connectionId
				? await context.db.query.gpsConnection.findFirst({
						where: {
							id: selectedVehicle.connectionId,
							organizationId: context.organizationId,
						},
					})
				: null;
			const activeTrip = await context.db.query.trip.findFirst({
				columns: {
					id: true,
					name: true,
					destinationName: true,
					etaAt: true,
					status: true,
				},
				where: {
					vehicleId: id,
					organizationId: context.organizationId,
					status: TRIP_STATUS_ACTIVE,
				},
			});
			context.log.set({ fleet: { vehicleId: id, profileUpdated: true } });
			return {
				...selectedVehicle,
				...profile,
				updatedAt,
				profile,
				provider: connection?.provider ?? null,
				activeTrip: activeTrip ?? null,
			};
		}),
	list: organizationProcedure
		.input(z.void())
		.output(z.array(profiledVehicleSummarySchema))
		.handler(async ({ context }) => {
			const vehicles = await context.db.query.vehicle.findMany({
				where: { organizationId: context.organizationId },
				orderBy: { name: "asc", id: "asc" },
				with: {
					connection: { columns: { provider: true } },
					trips: {
						columns: {
							id: true,
							name: true,
							destinationName: true,
							etaAt: true,
							status: true,
						},
						where: {
							organizationId: context.organizationId,
							status: TRIP_STATUS_ACTIVE,
						},
						orderBy: { createdAt: "desc", id: "desc" },
						limit: SINGLE_RESULT_LIMIT_ROWS,
					},
				},
			});
			context.log.set({
				fleet: {
					organizationId: context.organizationId,
					vehiclesListed: vehicles.length,
				},
			});
			return vehicles.map(({ connection, trips, ...vehicle }) => {
				const [activeTrip] = trips;
				return {
					...vehicle,
					provider: connection?.provider ?? null,
					profile: vehicleProfile(vehicle),
					activeTrip: activeTrip ?? null,
				};
			});
		}),
};
