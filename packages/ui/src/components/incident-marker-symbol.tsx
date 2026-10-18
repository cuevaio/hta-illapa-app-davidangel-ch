import type { Incident } from "../lib/incident";
import { INCIDENT_MARKER_TONE_CLASSES } from "../lib/incident-constants";
import { cn } from "../lib/utils";
import { INCIDENT_CATEGORY_ICONS } from "./incident-icons";

export interface IncidentMarkerSymbolProps {
	category: Incident["category"];
	tone: keyof typeof INCIDENT_MARKER_TONE_CLASSES;
	variant?: "filled" | "outline";
	className?: string;
}

export function IncidentMarkerSymbol({
	category,
	tone,
	variant = "filled",
	className,
}: IncidentMarkerSymbolProps) {
	const CategoryIcon = INCIDENT_CATEGORY_ICONS[category];
	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex size-7 shrink-0 items-center justify-center rounded-full border-2",
				variant === "filled"
					? cn("border-background", INCIDENT_MARKER_TONE_CLASSES[tone].filled)
					: cn("text-foreground", INCIDENT_MARKER_TONE_CLASSES[tone].outline),
				className,
			)}
		>
			<CategoryIcon className="size-4" />
		</span>
	);
}
