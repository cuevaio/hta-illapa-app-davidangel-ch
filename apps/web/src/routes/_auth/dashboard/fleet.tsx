import { Button } from "@hack-the-andes-project/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@hack-the-andes-project/ui/components/empty";
import { FleetLoadingSkeleton } from "@hack-the-andes-project/ui/components/fleet-loading-skeleton";
import { FleetPlannedTrips } from "@hack-the-andes-project/ui/components/fleet-planned-trips";
import { FleetQueryFeedback } from "@hack-the-andes-project/ui/components/fleet-query-feedback";
import { PlusIcon } from "@hack-the-andes-project/ui/components/icons";
import { VehicleProfileDialog } from "@hack-the-andes-project/ui/components/vehicle-profile-dialog";
import type { FleetRouteVehicle } from "@hack-the-andes-project/ui/lib/fleet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	FLEET_REFETCH_INTERVAL_MS,
	STALE_TRIP_EVALUATION_MS,
} from "@/constants";
import { invalidateFleetQueries } from "@/lib/fleet-queries";
import {
	formatRouteReviewDuration,
	formatRouteReviewRelativeTime,
	formatRouteReviewWeekdayDateTime,
	getRouteEnumLabels,
} from "@/lib/route-review-labels";
import {
	invalidateRouteReviewQueries,
	useRouteReviewQueries,
} from "@/lib/route-review-queries";
import {
	getVehicleProfileDialogLabels,
	getVehicleTypeLabels,
	useSaveVehicleProfile,
} from "@/lib/vehicle-profile";
import { m } from "@/paraglide/messages";
import { orpc } from "@/utils/orpc";

interface FleetSearch {
	vehiculo?: string;
}

export const Route = createFileRoute("/_auth/dashboard/fleet")({
	validateSearch: (search: Record<string, unknown>): FleetSearch => ({
		vehiculo: typeof search.vehiculo === "string" ? search.vehiculo : undefined,
	}),
	component: FleetPage,
});

function FleetPage() {
	const routeReviewQueries = useRouteReviewQueries();
	const queryClient = useQueryClient();
	const navigate = Route.useNavigate();
	const { vehiculo } = Route.useSearch();
	const vehiclesQuery = useQuery(routeReviewQueries.vehicles);
	const tripsQuery = useQuery(routeReviewQueries.plannedTrips);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingVehicle, setEditingVehicle] =
		useState<FleetRouteVehicle | null>(null);
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const interval = window.setInterval(
			() => setNow(new Date()),
			FLEET_REFETCH_INTERVAL_MS,
		);
		return () => window.clearInterval(interval);
	}, []);
	const vehicles = vehiclesQuery.data ?? [];
	const trips = tripsQuery.data ?? [];
	const emptyFleet =
		vehiclesQuery.isSuccess &&
		vehicles.length === 0 &&
		tripsQuery.isSuccess &&
		trips.length === 0;
	const routeEnumLabels = getRouteEnumLabels();
	const vehicleTypeLabels = getVehicleTypeLabels();
	const saveVehicle = useSaveVehicleProfile({ vehicle: editingVehicle });
	const createDemoConnection = useMutation(
		orpc.connections.create.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					invalidateFleetQueries(queryClient),
					invalidateRouteReviewQueries(queryClient),
				]);
				toast.success(m.fleet_demo_connected());
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	return (
		<div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6">
			<div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
				<div className="flex flex-col gap-2">
					<h2 className="type-title">{m.fleet_title()}</h2>
					<p className="type-body text-muted-foreground">
						{m.fleet_description()}
					</p>
				</div>
				{!emptyFleet && (
					<div className="flex shrink-0 flex-col gap-2 sm:flex-row">
						<Button
							nativeButton={false}
							className="min-h-11 sm:order-2"
							render={<Link to="/dashboard/revisar-ruta" />}
						>
							{m.plan_trip()}
						</Button>
						<Button
							className="min-h-11"
							variant="outline"
							onClick={() => {
								setEditingVehicle(null);
								setDialogOpen(true);
							}}
						>
							<PlusIcon aria-hidden="true" />
							{m.add_vehicle()}
						</Button>
					</div>
				)}
			</div>
			<FleetQueryFeedback
				isPending={vehiclesQuery.isPending || tripsQuery.isPending}
				isError={vehiclesQuery.isError || tripsQuery.isError}
				onRetry={() => {
					void vehiclesQuery.refetch();
					void tripsQuery.refetch();
				}}
				labels={{
					errorTitle: m.fleet_error_title(),
					errorDescription: m.fleet_error_description(),
					retry: m.query_retry(),
					loading: m.fleet_loading(),
				}}
				skeleton={<FleetLoadingSkeleton />}
			/>
			{emptyFleet ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyTitle>{m.fleet_empty_title()}</EmptyTitle>
						<EmptyDescription>{m.fleet_empty_description()}</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<div className="flex w-full flex-col justify-center gap-2 sm:flex-row">
							<Button
								className="min-h-11"
								onClick={() => {
									setEditingVehicle(null);
									setDialogOpen(true);
								}}
							>
								<PlusIcon aria-hidden="true" />
								{m.add_vehicle()}
							</Button>
							<Button
								variant="outline"
								className="min-h-11"
								disabled={createDemoConnection.isPending}
								onClick={() =>
									createDemoConnection.mutate({
										label: "Flota demo",
										credentials: { provider: "demo" },
									})
								}
							>
								{createDemoConnection.isPending
									? m.fleet_demo_connecting()
									: m.fleet_demo()}
							</Button>
						</div>
						<Button
							nativeButton={false}
							variant="link"
							className="min-h-11"
							render={<Link to="/dashboard/settings" />}
						>
							{m.fleet_connect_gps()}
						</Button>
					</EmptyContent>
				</Empty>
			) : vehiclesQuery.data || tripsQuery.data ? (
				<FleetPlannedTrips
					vehicles={vehicles}
					trips={trips}
					hasTripData={Boolean(tripsQuery.data)}
					now={now}
					staleEvaluationMs={STALE_TRIP_EVALUATION_MS}
					selectedVehicleId={vehiculo ?? null}
					onSelectedVehicleIdChange={(vehicleId) => {
						void navigate({
							search: { vehiculo: vehicleId ?? undefined },
							replace: true,
						});
					}}
					tripLink={(trip) => (
						<Link
							to="/dashboard/fleet/viajes/$tripId"
							params={{ tripId: trip.id }}
						/>
					)}
					planTripLink={(vehicle) => (
						<Link
							to="/dashboard/revisar-ruta"
							search={{ vehiculo: vehicle?.id }}
						/>
					)}
					connectionsLink={<Link to="/dashboard/settings" />}
					onSetVehicleType={(vehicle) => {
						setEditingVehicle(vehicle);
						setDialogOpen(true);
					}}
					formatDeparture={formatRouteReviewWeekdayDateTime}
					formatEvaluatedAgo={formatRouteReviewRelativeTime}
					labels={{
						filter: m.vehicle(),
						allVehicles: (count) => m.fleet_all_vehicles({ count }),
						upcomingCount: (count) =>
							count === 1
								? m.fleet_upcoming_count_one({ count })
								: m.fleet_upcoming_count({ count }),
						connections: m.fleet_connections(),
						upcoming: m.fleet_upcoming(),
						noUpcoming: m.fleet_no_upcoming(),
						history: (count) => m.fleet_history({ count }),
						route: m.fleet_route(),
						departure: m.fleet_departure(),
						chosenPath: m.fleet_chosen_path(),
						riskAction: m.fleet_risk_action(),
						evaluated: m.evaluated(),
						stale: m.fleet_stale(),
						recommendation: (action) => routeEnumLabels.recommendations[action],
						departAt: (date) =>
							m.route_review_depart_at({
								date: formatRouteReviewWeekdayDateTime(date),
							}),
						delay: (seconds) =>
							m.route_review_delay({
								duration: formatRouteReviewDuration(seconds),
							}),
						rerouteTo: (name) => m.route_review_reroute_to({ route: name }),
						noType: m.vehicle_no_type(),
						setType: m.set_vehicle_type(),
						missingTypeTitle: (name) => m.fleet_missing_type_title({ name }),
						missingTypesTitle: (count) =>
							m.fleet_missing_types_title({ count }),
						missingTypeDescription: (count) =>
							count === 1
								? m.fleet_missing_type_description_one()
								: m.fleet_missing_type_description(),
						planTrip: m.plan_trip(),
						planWithVehicle: m.fleet_plan_with_vehicle(),
						planNamedVehicle: (name) => m.fleet_plan_named_vehicle({ name }),
						noTripsTitle: m.fleet_no_trips_title(),
						noTripsDescription: m.fleet_no_trips_description(),
						filterEmpty: (name) => m.fleet_filter_empty({ name }),
						filterMissingType: (name) => m.fleet_filter_missing_type({ name }),
						viewAll: m.fleet_view_all(),
						deletedVehicle: m.fleet_deleted_vehicle(),
						departed: m.fleet_departed(),
						manual: m.vehicle_dialog_manual(),
						axleCount: (count) => m.axle_count({ count }),
						gpsProvider: (provider) => m.fleet_gps_provider({ provider }),
						weightTonnes: (tonnes) => m.fleet_weight_tonnes({ tonnes }),
						unknownRisk: m.fleet_unknown_risk(),
						...routeEnumLabels,
						vehicleTypes: vehicleTypeLabels,
					}}
				/>
			) : null}
			<VehicleProfileDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				vehicle={editingVehicle}
				isPending={saveVehicle.isPending}
				onSubmit={saveVehicle.mutateAsync}
				vehicleTypeLabels={vehicleTypeLabels}
				labels={getVehicleProfileDialogLabels()}
			/>
		</div>
	);
}
