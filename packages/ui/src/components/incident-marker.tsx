import type { Incident } from "@hack-the-andes-project/ui/lib/incident";
import {
	INCIDENT_CATEGORY_LABELS,
	INCIDENT_SEVERITY_LABELS,
	INCIDENT_SEVERITY_TEXT_CLASSES,
	INCIDENT_SEVERITY_TONES,
} from "@hack-the-andes-project/ui/lib/incident-constants";
import { cn } from "@hack-the-andes-project/ui/lib/utils";
import { formatDistanceToNowStrict } from "date-fns";
import { es } from "date-fns/locale/es";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card";
import { INCIDENT_CATEGORY_ICONS } from "./incident-icons";
import { IncidentMarkerSymbol } from "./incident-marker-symbol";
import {
	INCIDENT_PREVIEW_CLOSE_DELAY_MS,
	INCIDENT_PREVIEW_OFFSET_PX,
	INCIDENT_PREVIEW_OPEN_DELAY_MS,
} from "./map-constants";
import { Marker } from "./map-view";
import { SeverityBadge } from "./severity";

export interface IncidentMarkerProps {
	incident: Incident;
	onSelect?: (incidentId: string) => void;
}

export function IncidentMarker({ incident, onSelect }: IncidentMarkerProps) {
	if (incident.lat === null || incident.lng === null) return null;
	const CategoryIcon = INCIDENT_CATEGORY_ICONS[incident.category];
	const location = [incident.roadCode, incident.region]
		.filter(Boolean)
		.join(" · ");

	return (
		<Marker latitude={incident.lat} longitude={incident.lng}>
			<HoverCard>
				<HoverCardTrigger
					delay={INCIDENT_PREVIEW_OPEN_DELAY_MS}
					closeDelay={INCIDENT_PREVIEW_CLOSE_DELAY_MS}
					render={<button type="button" />}
					aria-label={`${incident.title} · ${INCIDENT_CATEGORY_LABELS[incident.category]} · ${INCIDENT_SEVERITY_LABELS[incident.severity]}`}
					onClick={(event) => {
						event.stopPropagation();
						onSelect?.(incident.id);
					}}
					className="flex size-7 items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 motion-reduce:transition-none motion-reduce:hover:scale-100"
				>
					<IncidentMarkerSymbol
						category={incident.category}
						tone={INCIDENT_SEVERITY_TONES[incident.severity]}
					/>
				</HoverCardTrigger>
				<HoverCardContent
					side="top"
					sideOffset={INCIDENT_PREVIEW_OFFSET_PX}
					className="pointer-events-none flex w-72 flex-col gap-1.5"
				>
					<div className="type-label flex items-center gap-2 text-muted-foreground">
						<CategoryIcon
							className={cn(
								"size-3.5 shrink-0",
								INCIDENT_SEVERITY_TEXT_CLASSES[incident.severity],
							)}
						/>
						<span className="truncate">
							{INCIDENT_CATEGORY_LABELS[incident.category]}
						</span>
						<SeverityBadge severity={incident.severity} className="ml-auto" />
					</div>
					<p className="type-heading line-clamp-2 break-words text-foreground">
						{incident.title}
					</p>
					{incident.description && (
						<p className="type-body line-clamp-3 whitespace-pre-line break-words text-muted-foreground">
							{incident.description}
						</p>
					)}
					{(location || incident.occurredAt) && (
						<p className="type-data text-muted-foreground">
							{location}
							{location && incident.occurredAt && " · "}
							{incident.occurredAt && (
								<time dateTime={incident.occurredAt.toISOString()}>
									{formatDistanceToNowStrict(incident.occurredAt, {
										addSuffix: true,
										locale: es,
									})}
								</time>
							)}
						</p>
					)}
				</HoverCardContent>
			</HoverCard>
		</Marker>
	);
}
