import { peakRiskAssessment } from "@hack-the-andes-project/business/route-review/ranking";
import type { RouteRiskHorizon } from "@hack-the-andes-project/business/route-review/risk";
import type {
	RouteReviewSegment,
	RouteReviewSignal,
} from "../lib/route-review";
import { IncidentMarkerSymbol } from "./incident-marker-symbol";

interface RouteReviewSignalSymbolProps {
	signal: RouteReviewSignal;
	signalSegments: RouteReviewSegment[];
	horizon: RouteRiskHorizon;
}
export function RouteReviewSignalSymbol({
	signal,
	signalSegments,
	horizon,
}: RouteReviewSignalSymbolProps) {
	const risk = peakRiskAssessment(
		signalSegments.flatMap((segment) =>
			segment.risk.filter((assessment) => assessment.horizon === horizon),
		),
	);
	return (
		<IncidentMarkerSymbol
			category={signal.incidentCategory ?? "other"}
			tone={risk?.level ?? "neutral"}
			variant={signal.kind === "confirmed" ? "filled" : "outline"}
		/>
	);
}
