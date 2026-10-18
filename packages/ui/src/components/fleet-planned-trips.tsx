import { KG_PER_TONNE } from "@hack-the-andes-project/business/constants";
import { GPS_PROVIDER_LABELS } from "@hack-the-andes-project/business/providers/index";
import { ROUTE_REVIEW_PLACES } from "@hack-the-andes-project/business/route-review/places";
import { tripWindowRiskAssessment } from "@hack-the-andes-project/business/route-review/ranking";
import { isUpcomingTrip } from "@hack-the-andes-project/business/route-review/trips";
import { type ReactElement, useId } from "react";
import type {
	FleetPlannedTrip,
	FleetPlannedTripsLabels,
	FleetRouteVehicle,
} from "../lib/fleet";
import {
	formatRouteRecommendation,
	vehicleTypeShortLabel,
} from "../lib/route-review";
import { Alert, AlertDescription, AlertTitle } from "./alert";
import { Badge } from "./badge";
import { Button } from "./button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "./collapsible";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "./empty";
import { ChevronRightIcon, TriangleAlertIcon } from "./icons";
import { NativeSelect, NativeSelectOption } from "./native-select";
import { RouteReviewRiskBadge } from "./route-review-risk-badge";
import { RouteReviewSourceBadge } from "./route-review-source-badge";

export interface FleetPlannedTripsProps {
	vehicles: FleetRouteVehicle[];
	trips: FleetPlannedTrip[];
	hasTripData?: boolean;
	now: Date;
	staleEvaluationMs: number;
	selectedVehicleId: string | null;
	onSelectedVehicleIdChange: (id: string | null) => void;
	tripLink: (trip: FleetPlannedTrip) => ReactElement;
	planTripLink: (vehicle: FleetRouteVehicle | null) => ReactElement;
	connectionsLink: ReactElement;
	onSetVehicleType: (vehicle: FleetRouteVehicle) => void;
	formatDeparture: (date: Date) => string;
	formatEvaluatedAgo: (date: Date) => string;
	labels: FleetPlannedTripsLabels;
}

export function FleetPlannedTrips(props: FleetPlannedTripsProps) {
	const {
		vehicles,
		trips,
		now,
		selectedVehicleId,
		onSelectedVehicleIdChange,
		planTripLink,
		onSetVehicleType,
		labels,
	} = props;
	const filterId = useId();
	const selectedVehicle =
		vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null;
	const scopedVehicles = selectedVehicle ? [selectedVehicle] : vehicles;
	const scopedTrips = selectedVehicle
		? trips.filter((trip) => trip.vehicleId === selectedVehicle.id)
		: trips;
	const upcomingTrips: FleetPlannedTrip[] = [];
	const historyTrips: FleetPlannedTrip[] = [];
	for (const trip of scopedTrips) {
		if (isUpcomingTrip(trip, now)) upcomingTrips.push(trip);
		else historyTrips.push(trip);
	}
	upcomingTrips.sort(
		(first, second) =>
			first.departureAt.getTime() - second.departureAt.getTime(),
	);
	historyTrips.sort(
		(first, second) =>
			second.departureAt.getTime() - first.departureAt.getTime(),
	);
	const groupedTrips = new Map<string, FleetPlannedTrip[]>();
	for (const trip of upcomingTrips) {
		const vehicleTrips = groupedTrips.get(trip.vehicleId);
		if (vehicleTrips) vehicleTrips.push(trip);
		else groupedTrips.set(trip.vehicleId, [trip]);
	}
	const idleVehicles = scopedVehicles
		.filter((vehicle) => !groupedTrips.has(vehicle.id))
		.sort(
			(first, second) =>
				Number(Boolean(first.profile)) - Number(Boolean(second.profile)),
		);
	const missingTypeVehicles = vehicles.filter((vehicle) => !vehicle.profile);
	const firstMissingVehicle = missingTypeVehicles[0];
	return (
		<div className="flex min-w-0 flex-col gap-6">
			{firstMissingVehicle && (
				<Alert variant="info">
					<TriangleAlertIcon aria-hidden="true" />
					<AlertTitle>
						{missingTypeVehicles.length === 1
							? labels.missingTypeTitle(firstMissingVehicle.name)
							: labels.missingTypesTitle(missingTypeVehicles.length)}
					</AlertTitle>
					<AlertDescription>
						<p>{labels.missingTypeDescription(missingTypeVehicles.length)}</p>
						{missingTypeVehicles.length === 1 && (
							<Button
								className="min-h-11 w-fit"
								variant="outline"
								onClick={() => onSetVehicleType(firstMissingVehicle)}
							>
								{labels.setType}
							</Button>
						)}
					</AlertDescription>
				</Alert>
			)}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div className="flex min-w-0 flex-col gap-2">
					<label htmlFor={filterId} className="font-medium text-sm">
						{labels.filter}
					</label>
					<NativeSelect
						id={filterId}
						className="w-full sm:w-72 [&_select]:min-h-11"
						value={selectedVehicle?.id ?? ""}
						onChange={(event) =>
							onSelectedVehicleIdChange(event.target.value || null)
						}
					>
						<NativeSelectOption value="">
							{labels.allVehicles(vehicles.length)}
						</NativeSelectOption>
						{vehicles.map((vehicle) => (
							<NativeSelectOption key={vehicle.id} value={vehicle.id}>
								{vehicle.name}
								{vehicle.profile ? "" : ` · ${labels.noType}`}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</div>
				<div className="flex flex-wrap items-center gap-x-3">
					<p role="status" className="type-data text-muted-foreground">
						{props.hasTripData === false
							? "—"
							: labels.upcomingCount(upcomingTrips.length)}
					</p>
					<Button
						nativeButton={false}
						variant="link"
						className="min-h-11 px-0"
						render={props.connectionsLink}
					>
						{labels.connections}
						<ChevronRightIcon aria-hidden="true" />
					</Button>
				</div>
			</div>
			{props.hasTripData !== false && (
				<section
					className="flex min-w-0 flex-col gap-4"
					aria-labelledby={`${filterId}-upcoming`}
				>
					<h3 id={`${filterId}-upcoming`} className="type-heading">
						{labels.upcoming}
					</h3>
					{upcomingTrips.length > 0 ? (
						<>
							<div
								aria-hidden="true"
								className="type-label hidden gap-4 px-4 text-muted-foreground md:grid md:grid-cols-[1.2fr_1fr_1.5fr_1.3fr_1fr]"
							>
								{[
									labels.route,
									labels.departure,
									labels.chosenPath,
									labels.riskAction,
									labels.evaluated,
								].map((label) => (
									<span key={label}>{label}</span>
								))}
							</div>
							{Array.from(groupedTrips, ([vehicleId, vehicleTrips]) => {
								const vehicle = vehicles.find(
									(entry) => entry.id === vehicleId,
								);
								return (
									<div key={vehicleId} className="flex min-w-0 flex-col gap-2">
										{vehicle ? (
											<FleetVehicleHeader
												vehicle={vehicle}
												labels={labels}
												planTripLink={planTripLink}
												onSetVehicleType={onSetVehicleType}
											/>
										) : (
											<h4 className="font-semibold">
												{vehicleTrips[0]?.vehicleName ?? labels.deletedVehicle}
											</h4>
										)}
										<ul className="divide-y overflow-hidden rounded-lg border bg-card">
											{vehicleTrips.map((trip) => (
												<FleetTripRow key={trip.id} trip={trip} {...props} />
											))}
										</ul>
									</div>
								);
							})}
						</>
					) : (
						<Empty className="border">
							<EmptyHeader>
								<EmptyTitle>
									{selectedVehicle
										? labels.filterEmpty(selectedVehicle.name)
										: labels.noTripsTitle}
								</EmptyTitle>
								<EmptyDescription>
									{selectedVehicle && !selectedVehicle.profile
										? labels.filterMissingType(selectedVehicle.name)
										: labels.noTripsDescription}
								</EmptyDescription>
							</EmptyHeader>
							<EmptyContent className="flex-row flex-wrap justify-center">
								{selectedVehicle && !selectedVehicle.profile ? (
									<Button
										variant="outline"
										className="min-h-11"
										onClick={() => onSetVehicleType(selectedVehicle)}
									>
										{labels.setType}
									</Button>
								) : (
									<Button
										nativeButton={false}
										variant="outline"
										className="min-h-11"
										render={planTripLink(selectedVehicle)}
									>
										{selectedVehicle
											? labels.planNamedVehicle(selectedVehicle.name)
											: labels.planTrip}
									</Button>
								)}
								{selectedVehicle && (
									<Button
										variant="ghost"
										className="min-h-11"
										onClick={() => onSelectedVehicleIdChange(null)}
									>
										{labels.viewAll}
									</Button>
								)}
							</EmptyContent>
						</Empty>
					)}
				</section>
			)}
			{idleVehicles.length > 0 && (
				<section
					className="flex flex-col gap-3"
					aria-labelledby={`${filterId}-idle`}
				>
					<h3 id={`${filterId}-idle`} className="type-heading">
						{props.hasTripData === false ? labels.filter : labels.noUpcoming}
					</h3>
					<ul className="divide-y rounded-lg border bg-card">
						{idleVehicles.map((vehicle) => (
							<li key={vehicle.id} className="p-3">
								<FleetVehicleHeader
									vehicle={vehicle}
									labels={labels}
									planTripLink={planTripLink}
									onSetVehicleType={onSetVehicleType}
								/>
							</li>
						))}
					</ul>
				</section>
			)}
			{historyTrips.length > 0 && (
				<Collapsible>
					<h3>
						<CollapsibleTrigger
							render={<Button variant="ghost" className="min-h-11 px-0" />}
						>
							<ChevronRightIcon
								aria-hidden="true"
								className="in-[[data-panel-open]]:rotate-90"
							/>
							{labels.history(historyTrips.length)}
						</CollapsibleTrigger>
					</h3>
					<CollapsibleContent>
						<ul className="mt-3 divide-y overflow-hidden rounded-lg border bg-card">
							{historyTrips.map((trip) => (
								<FleetTripRow key={trip.id} trip={trip} history {...props} />
							))}
						</ul>
					</CollapsibleContent>
				</Collapsible>
			)}
		</div>
	);
}

interface FleetVehicleHeaderProps {
	vehicle: FleetRouteVehicle;
	labels: FleetPlannedTripsLabels;
	planTripLink: FleetPlannedTripsProps["planTripLink"];
	onSetVehicleType: FleetPlannedTripsProps["onSetVehicleType"];
}

function FleetVehicleHeader({
	vehicle,
	labels,
	planTripLink,
	onSetVehicleType,
}: FleetVehicleHeaderProps) {
	const profile = vehicle.profile;
	return (
		<div className="flex min-w-0 flex-col justify-between gap-2 sm:flex-row sm:items-center">
			<div className="min-w-0">
				<h4 className="break-words font-semibold">{vehicle.name}</h4>
				<div className="type-data flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
					{vehicle.plate && <span>{vehicle.plate} ·</span>}
					{profile ? (
						<>
							<span>
								{vehicleTypeShortLabel(
									profile.vehicleTypeId,
									labels.vehicleTypes,
								)}{" "}
								· {labels.axleCount(profile.axleCount)}
							</span>
							{profile.grossWeightKg !== null && (
								<span>
									· {labels.weightTonnes(profile.grossWeightKg / KG_PER_TONNE)}
								</span>
							)}
						</>
					) : (
						<Badge variant="outline">
							<TriangleAlertIcon aria-hidden="true" />
							{labels.noType}
						</Badge>
					)}
					<span>
						·{" "}
						{vehicle.provider
							? labels.gpsProvider(GPS_PROVIDER_LABELS[vehicle.provider])
							: labels.manual}
					</span>
				</div>
			</div>
			{profile ? (
				<Button
					nativeButton={false}
					className="min-h-11 shrink-0 self-start px-0 sm:self-auto"
					variant="link"
					render={planTripLink(vehicle)}
				>
					{labels.planWithVehicle}
					<ChevronRightIcon aria-hidden="true" />
				</Button>
			) : (
				<Button
					className="min-h-11 shrink-0 self-start sm:self-auto"
					variant="outline"
					onClick={() => onSetVehicleType(vehicle)}
				>
					{labels.setType}
				</Button>
			)}
		</div>
	);
}

interface FleetTripRowProps extends FleetPlannedTripsProps {
	trip: FleetPlannedTrip;
	history?: boolean;
}

function FleetTripRow({
	trip,
	history = false,
	now,
	staleEvaluationMs,
	tripLink,
	formatDeparture,
	formatEvaluatedAgo,
	labels,
}: FleetTripRowProps) {
	const risk = tripWindowRiskAssessment(
		trip.chosenCandidate.risk,
		trip.departureAt,
		trip.chosenCandidate.durationS,
		trip.lastEvaluatedAt,
	);
	const recommendation = trip.chosenCandidate.recommendation;
	const routeName = `${ROUTE_REVIEW_PLACES[trip.originPlaceId].name} → ${ROUTE_REVIEW_PLACES[trip.destinationPlaceId].name}`;
	return (
		<li className="relative grid min-w-0 gap-3 p-4 focus-within:z-10 focus-within:ring-2 focus-within:ring-ring focus-within:ring-inset hover:bg-muted/50 md:grid-cols-[1.2fr_1fr_1.5fr_1.3fr_1fr]">
			<div className="min-w-0">
				<div className="flex flex-wrap gap-1">
					{history ? (
						<Badge variant="outline">{labels.tripStatuses[trip.status]}</Badge>
					) : trip.status === "active" ? (
						<Badge variant="outline">{labels.tripStatuses.active}</Badge>
					) : trip.departureAt < now ? (
						<Badge variant="outline">{labels.departed}</Badge>
					) : null}
				</div>
				<Button
					nativeButton={false}
					render={tripLink(trip)}
					variant="link"
					aria-label={`${routeName}, ${trip.name}`}
					className="h-auto justify-start whitespace-normal p-0 text-left after:absolute after:inset-0"
				>
					{routeName}
				</Button>
				<p className="break-words text-muted-foreground text-sm">{trip.name}</p>
				{history && (
					<p className="text-sm">{trip.vehicleName ?? labels.deletedVehicle}</p>
				)}
			</div>
			<p className="type-data">
				<span className="md:sr-only">{labels.departure} </span>
				{formatDeparture(trip.departureAt)}
			</p>
			<div className="min-w-0">
				<span className="sr-only">{labels.chosenPath} </span>
				<RouteReviewSourceBadge
					source={trip.chosenCandidate.source}
					label={labels.sources[trip.chosenCandidate.source]}
				/>
				<p
					title={trip.chosenCandidate.name}
					className="mt-1 line-clamp-2 break-words text-sm"
				>
					{trip.chosenCandidate.name}
				</p>
			</div>
			{!history && (
				<div className="flex min-w-0 flex-col items-start gap-1">
					<span className="sr-only">{labels.riskAction} </span>
					{risk ? (
						<RouteReviewRiskBadge
							level={risk.level}
							label={labels.riskLevels[risk.level]}
							horizonLabel={labels.horizons[risk.horizon]}
						/>
					) : (
						<span>{labels.unknownRisk}</span>
					)}
					<p className="text-sm">
						{formatRouteRecommendation(recommendation, labels)}
					</p>
				</div>
			)}
			<p className="type-data text-muted-foreground">
				<span className="md:sr-only">{labels.evaluated} </span>
				{formatEvaluatedAgo(trip.lastEvaluatedAt)}
				{now.getTime() - trip.lastEvaluatedAt.getTime() > staleEvaluationMs
					? ` · ${labels.stale}`
					: ""}
			</p>
			<ChevronRightIcon
				aria-hidden="true"
				className="absolute top-4 right-2 size-4 md:top-1/2"
			/>
		</li>
	);
}
