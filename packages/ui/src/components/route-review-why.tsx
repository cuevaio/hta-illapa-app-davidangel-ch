import {
	ROUTE_SIGNAL_KINDS,
	type RouteRiskHorizon,
} from "@hack-the-andes-project/business/route-review/risk";
import type {
	RouteReviewCandidate,
	RouteReviewLabels,
} from "../lib/route-review";
import { ExternalLinkIcon } from "./icons";
import { RouteReviewSignalSymbol } from "./route-review-signal-symbol";
import { RouteReviewSignalTag } from "./route-review-signal-tag";

interface RouteReviewWhyProps {
	candidate: RouteReviewCandidate;
	horizon: RouteRiskHorizon;
	labels: RouteReviewLabels;
}
export function RouteReviewWhy({
	candidate,
	horizon,
	labels,
}: RouteReviewWhyProps) {
	return (
		<div className="flex flex-col gap-4 border-t pt-4">
			<p>
				<span className="type-label">{labels.ruleLabel}</span> ·{" "}
				{labels.rule(candidate.recommendation.rule)} →{" "}
				{labels.recommendation(candidate.recommendation.action)}
			</p>
			{candidate.signals.length === 0 ? <p>{labels.noSignals}</p> : null}
			{ROUTE_SIGNAL_KINDS.map((kind) =>
				candidate.signals
					.filter((signal) => signal.kind === kind)
					.map((signal) => {
						const segments = candidate.segments.filter((segment) =>
							signal.segmentIds.includes(segment.id),
						);
						return (
							<article key={signal.id} className="flex flex-col gap-1">
								<div className="type-label flex flex-wrap items-center gap-2">
									{kind === "baseline" ? (
										<RouteReviewSignalTag
											kind={kind}
											label={labels.signalKind(kind)}
										/>
									) : (
										<span className="inline-flex items-center gap-2">
											<RouteReviewSignalSymbol
												signal={signal}
												signalSegments={segments}
												horizon={horizon}
											/>
											{labels.signalKind(kind)}
										</span>
									)}
									{segments.length
										? labels.kmRange(
												Math.min(...segments.map((segment) => segment.startM)),
												Math.max(...segments.map((segment) => segment.endM)),
											)
										: null}
								</div>
								<h4 className="font-semibold">{signal.title}</h4>
								{signal.detail ? <p>{signal.detail}</p> : null}
								{signal.roadStatus ? (
									<p className="font-medium">
										{labels.roadStatus(signal.roadStatus)}
									</p>
								) : null}
								<p className="flex flex-wrap items-center gap-1 text-muted-foreground">
									{signal.sourceUrl ? (
										<a
											className="relative inline-flex min-h-11 items-center gap-1 underline underline-offset-4"
											href={signal.sourceUrl}
											target="_blank"
											rel="noreferrer"
										>
											{signal.source}
											<ExternalLinkIcon className="size-3" />
										</a>
									) : (
										signal.source
									)}{" "}
									·{" "}
									<time
										dateTime={signal.observedAt.toISOString()}
										title={labels.dateTime(signal.observedAt)}
									>
										{labels.observedAt(signal.observedAt)}
									</time>
								</p>
								{signal.validFrom || signal.validUntil ? (
									<p>
										{labels.valid}{" "}
										{signal.validFrom ? (
											<time dateTime={signal.validFrom.toISOString()}>
												{labels.dateTime(signal.validFrom)}
											</time>
										) : null}
										{signal.validFrom && signal.validUntil ? " – " : null}
										{signal.validUntil ? (
											<time dateTime={signal.validUntil.toISOString()}>
												{labels.dateTime(signal.validUntil)}
											</time>
										) : null}
									</p>
								) : null}
							</article>
						);
					}),
			)}
			{candidate.explanation ? (
				<div className="flex flex-col gap-2 border-t pt-3">
					<h4 className="type-label">{labels.aiExplanation}</h4>
					<p>{candidate.explanation}</p>
				</div>
			) : null}
		</div>
	);
}
