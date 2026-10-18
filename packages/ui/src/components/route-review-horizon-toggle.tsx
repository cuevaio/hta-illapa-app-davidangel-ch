import type { RouteRiskHorizon } from "@hack-the-andes-project/business/route-review/risk";
import type { RouteReviewLabels } from "../lib/route-review";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

interface RouteReviewHorizonToggleProps {
	horizons: RouteRiskHorizon[];
	value: RouteRiskHorizon;
	onValueChange: (value: RouteRiskHorizon) => void;
	labels: RouteReviewLabels;
}
export function RouteReviewHorizonToggle({
	horizons,
	value,
	onValueChange,
	labels,
}: RouteReviewHorizonToggleProps) {
	return (
		<div className="flex flex-wrap items-center gap-3">
			<span className="type-label">{labels.risk}</span>
			<ToggleGroup
				value={[value]}
				onValueChange={(values) => {
					const next = horizons.find((horizon) => values.includes(horizon));
					if (next) onValueChange(next);
				}}
				variant="outline"
				aria-label={labels.risk}
			>
				{horizons.map((horizon) => (
					<Tooltip key={horizon}>
						<TooltipTrigger
							render={
								<ToggleGroupItem
									value={horizon}
									className="min-h-11 min-w-11"
								/>
							}
						>
							{labels.horizon(horizon)}
						</TooltipTrigger>
						<TooltipContent>
							{horizon === "now"
								? labels.horizon(horizon)
								: labels.horizonHelp(horizon)}
						</TooltipContent>
					</Tooltip>
				))}
			</ToggleGroup>
		</div>
	);
}
