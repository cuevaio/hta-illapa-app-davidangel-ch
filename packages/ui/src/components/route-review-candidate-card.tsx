import type { RouteRiskHorizon } from "@hack-the-andes-project/business/route-review/risk";
import { ROUTE_SIGNAL_KINDS } from "@hack-the-andes-project/business/route-review/risk";
import { cn } from "cn";
import {
	ArrowRightIcon,
	BanIcon,
	CheckIcon,
	ChevronDownIcon,
	ClockIcon,
	EyeIcon,
	RouteIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import {
	formatRouteRecommendation,
	type RouteReviewCandidate,
	type RouteReviewLabels,
} from "../lib/route-review";
import { Button } from "./button";
import { Card, CardContent, CardHeader, CardTitle } from "./card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "./collapsible";
import { RouteReviewRiskBadge } from "./route-review-risk-badge";
import { RouteReviewSignalTag } from "./route-review-signal-tag";
import { RouteReviewSourceBadge } from "./route-review-source-badge";
import { RouteReviewWhy } from "./route-review-why";
import { Skeleton } from "./skeleton";

interface RouteReviewCandidateCardProps {
	candidate: RouteReviewCandidate;
	horizon: RouteRiskHorizon;
	vehicleAxleCount: number;
	isSelected: boolean;
	isRecommended: boolean;
	isChosen: boolean;
	onSelect: () => void;
	onViewMap?: () => void;
	action?: ReactNode;
	rerouteName?: string;
	labels: RouteReviewLabels;
}
const recommendationIcons = {
	continue: ArrowRightIcon,
	monitor: EyeIcon,
	delay: ClockIcon,
	reroute: RouteIcon,
};
export function RouteReviewCandidateCard({
	candidate,
	horizon,
	vehicleAxleCount,
	isSelected,
	isRecommended,
	isChosen,
	onSelect,
	onViewMap,
	action,
	rerouteName,
	labels,
}: RouteReviewCandidateCardProps) {
	const assessment = candidate.risk.find((risk) => risk.horizon === horizon);
	const secondaryAssessment = candidate.risk.find(
		(risk) => risk.horizon === (horizon === "now" ? "24h" : "now"),
	);
	const RecommendationIcon =
		recommendationIcons[candidate.recommendation.action];
	return (
		<Card
			id={`route-review-candidate-${candidate.id}`}
			className={cn(
				"relative",
				isSelected && "ring-2 ring-ring",
				!candidate.eligibility.eligible && "bg-muted",
			)}
		>
			<CardHeader>
				<CardTitle>
					<button
						type="button"
						aria-pressed={isSelected}
						onClick={onSelect}
						className="min-h-11 text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
					>
						{!candidate.eligibility.eligible ? (
							<BanIcon aria-hidden="true" className="mr-1 inline size-4" />
						) : null}
						{candidate.name}
					</button>
				</CardTitle>
				<div className="flex flex-wrap items-center gap-2">
					<RouteReviewSourceBadge
						source={candidate.source}
						label={labels.source(candidate.source)}
					/>
					{isChosen ? (
						<span className="type-label inline-flex items-center gap-1">
							<CheckIcon className="size-3" />
							{labels.chosen}
						</span>
					) : null}
					{isRecommended ? (
						<span className="sr-only">{labels.recommended}</span>
					) : null}
				</div>
				<p className="type-data text-muted-foreground">
					{candidate.roadCodes.join(" · ")}
				</p>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				{!candidate.eligibility.eligible ? (
					<>
						<p className="font-semibold">
							{labels.notEligible(vehicleAxleCount)}
						</p>
						{candidate.eligibility.restriction ? (
							<p>
								{labels.source(candidate.source)}: «
								{candidate.eligibility.restriction}»
							</p>
						) : null}
					</>
				) : (
					<>
						<div className="flex flex-wrap gap-2">
							{assessment ? (
								<RouteReviewRiskBadge
									{...assessment}
									label={labels.riskLevel(assessment.level)}
								/>
							) : null}
							{secondaryAssessment ? (
								<RouteReviewRiskBadge
									{...secondaryAssessment}
									emphasis="secondary"
									label={labels.riskLevel(secondaryAssessment.level)}
									horizonLabel={labels.horizon(secondaryAssessment.horizon)}
								/>
							) : null}
						</div>
						<p className="flex items-start gap-2">
							<RecommendationIcon
								aria-hidden="true"
								className="size-4 shrink-0"
							/>
							<span>
								{formatRouteRecommendation(
									candidate.recommendation,
									labels,
									rerouteName,
								)}
							</span>
						</p>
						<p className="type-data">
							{labels.distance(candidate.distanceM)} ·{" "}
							{labels.duration(candidate.durationS)}
						</p>
						<div className="flex flex-wrap gap-2">
							{ROUTE_SIGNAL_KINDS.map((kind) => {
								const count = candidate.signals.filter(
									(signal) => signal.kind === kind,
								).length;
								return count ? (
									<RouteReviewSignalTag
										key={kind}
										kind={kind}
										label={labels.signalKind(kind, count)}
									/>
								) : null;
							})}
						</div>
						<Collapsible className="relative">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<CollapsibleTrigger
									render={<Button variant="ghost" className="min-h-11" />}
								>
									<ChevronDownIcon data-icon="inline-end" />
									{labels.why}
								</CollapsibleTrigger>
								{onViewMap ? (
									<Button
										variant="ghost"
										className="min-h-11 xl:hidden"
										onClick={onViewMap}
									>
										{labels.viewOnMap}
									</Button>
								) : null}
							</div>
							<CollapsibleContent>
								<RouteReviewWhy
									candidate={candidate}
									horizon={horizon}
									labels={labels}
								/>
							</CollapsibleContent>
						</Collapsible>
						{action ? (
							<div className="relative flex justify-end [&>button]:min-h-11 [&>button]:w-full xl:[&>button]:w-auto">
								{action}
							</div>
						) : null}
					</>
				)}
			</CardContent>
		</Card>
	);
}
export function RouteReviewCandidateSkeleton() {
	return (
		<Card>
			<CardHeader>
				<Skeleton className="h-6 w-3/4" />
				<Skeleton className="h-4 w-1/3" />
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				<Skeleton className="h-6 w-2/3" />
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-11 w-full" />
			</CardContent>
		</Card>
	);
}
