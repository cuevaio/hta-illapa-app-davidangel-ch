import { tripWindowRiskAssessment } from "@hack-the-andes-project/business/route-review/ranking";
import { BanIcon, PlayIcon, RefreshCwIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { RouteReviewLabels, RouteReviewTrip } from "../lib/route-review";
import { Badge } from "./badge";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "./breadcrumb";
import { Button } from "./button";
import { RouteReviewRiskBadge } from "./route-review-risk-badge";
import { RouteReviewSourceBadge } from "./route-review-source-badge";
import { Spinner } from "./spinner";

interface RouteReviewTripHeaderProps {
	trip: RouteReviewTrip;
	backLink: ReactNode;
	vehiclePlate?: string | null;
	canEdit: boolean;
	canCancel: boolean;
	canStart: boolean;
	startDisabled: boolean;
	departurePassed: boolean;
	isBusy: boolean;
	isRescoring: boolean;
	isStarting: boolean;
	onRescore: () => void;
	onCancel: () => void;
	onStart: () => void;
	labels: RouteReviewLabels;
	startLabel: string;
	startingLabel: string;
	gpsNote?: string;
}
export function RouteReviewTripHeader({
	trip,
	backLink,
	vehiclePlate,
	canEdit,
	canCancel,
	canStart,
	startDisabled,
	departurePassed,
	isBusy,
	isRescoring,
	isStarting,
	onRescore,
	onCancel,
	onStart,
	labels,
	startLabel,
	startingLabel,
	gpsNote,
}: RouteReviewTripHeaderProps) {
	const risk = tripWindowRiskAssessment(
		trip.chosenCandidate.risk,
		trip.departureAt,
		trip.chosenCandidate.durationS,
		trip.lastEvaluatedAt,
	);
	return (
		<header className="flex flex-col gap-4 border-b p-4">
			<Breadcrumb>
				<BreadcrumbList>
					<BreadcrumbItem>{backLink}</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage>{trip.name}</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="flex min-w-0 flex-col gap-2">
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="type-heading break-words">{trip.name}</h2>
						<Badge variant="secondary">
							{trip.status === "cancelled" ? (
								<BanIcon data-icon="inline-start" />
							) : null}
							{labels.tripStatus(trip.status)}
						</Badge>
					</div>
					<p className="type-data">
						{[
							trip.vehicleName,
							vehiclePlate,
							labels.axles(trip.review.vehicleAxleCount),
						]
							.filter(Boolean)
							.join(" · ")}{" "}
						·{" "}
						<time dateTime={trip.departureAt.toISOString()}>
							{labels.dateTime(trip.departureAt)}
						</time>
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					{canStart ? (
						<Button
							className="min-h-11"
							disabled={isBusy || startDisabled}
							onClick={onStart}
						>
							{isStarting ? (
								<Spinner data-icon="inline-start" />
							) : (
								<PlayIcon data-icon="inline-start" />
							)}
							{isStarting ? startingLabel : startLabel}
						</Button>
					) : null}
					{canEdit ? (
						<div className="flex flex-col gap-1">
							<Button
								variant={canStart ? "outline" : "default"}
								className="min-h-11"
								disabled={isBusy || departurePassed}
								onClick={onRescore}
								aria-describedby={
									departurePassed
										? `trip-${trip.id}-departure-passed`
										: undefined
								}
							>
								{isRescoring ? (
									<Spinner data-icon="inline-start" />
								) : (
									<RefreshCwIcon data-icon="inline-start" />
								)}
								{isRescoring ? labels.rescoring : labels.rescore}
							</Button>
							{departurePassed ? (
								<p
									id={`trip-${trip.id}-departure-passed`}
									className="text-muted-foreground text-xs"
								>
									{labels.departurePassed}
								</p>
							) : null}
						</div>
					) : null}
					{canCancel ? (
						<Button
							variant="outline"
							className="min-h-11"
							disabled={isBusy}
							onClick={onCancel}
						>
							{labels.cancelTrip}
						</Button>
					) : null}
				</div>
			</div>
			{gpsNote ? (
				<p className="text-muted-foreground text-sm">{gpsNote}</p>
			) : null}
			<div className="flex flex-wrap items-center gap-2 text-sm">
				<span>
					{labels.chosen}: {trip.chosenCandidate.name}
				</span>
				<RouteReviewSourceBadge
					source={trip.chosenCandidate.source}
					label={labels.source(trip.chosenCandidate.source)}
				/>
				{risk ? (
					<RouteReviewRiskBadge
						level={risk.level}
						score={risk.score}
						label={labels.riskLevel(risk.level)}
						horizonLabel={labels.horizon(risk.horizon)}
					/>
				) : null}
				<span>
					{labels.recommendation(trip.chosenCandidate.recommendation.action)}
				</span>
				<span>
					{labels.evaluated}{" "}
					<time dateTime={trip.lastEvaluatedAt.toISOString()}>
						{labels.observedAt(trip.lastEvaluatedAt)}
					</time>
				</span>
			</div>
		</header>
	);
}
