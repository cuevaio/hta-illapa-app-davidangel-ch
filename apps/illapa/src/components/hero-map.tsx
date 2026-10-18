import { IncidentMarkerSymbol } from "@hack-the-andes-project/ui/components/incident-marker-symbol";
import {
	Map as MapCanvas,
	MapMarker,
	MapRoute,
	MarkerContent,
	MarkerTooltip,
} from "@hack-the-andes-project/ui/components/map";
import { SeverityBadge } from "@hack-the-andes-project/ui/components/severity";
import { useTokenColors } from "@hack-the-andes-project/ui/hooks/use-token-colors";
import {
	INCIDENT_SEVERITY_LABELS,
	INCIDENT_SEVERITY_TONES,
} from "@hack-the-andes-project/ui/lib/incident-constants";

import {
	HERO_MAP_MAX_ZOOM,
	HERO_MAP_MIN_ZOOM,
	HERO_ROUTE_DASH_ARRAY,
	HERO_ROUTE_WIDTH_PX,
	PERU_BOUNDS,
	PERU_BOUNDS_PADDING_PX,
} from "@/constants";
import { HERO_HAZARDS, PANAMERICANA_NORTE_LIMA_PIURA } from "@/hero-data";

export default function HeroMap() {
	const tokenColors = useTokenColors(["--foreground"]);
	const routeColor = tokenColors["--foreground"];

	return (
		<MapCanvas
			className="h-full w-full"
			bounds={PERU_BOUNDS}
			fitBoundsOptions={{ padding: PERU_BOUNDS_PADDING_PX }}
			minZoom={HERO_MAP_MIN_ZOOM}
			maxZoom={HERO_MAP_MAX_ZOOM}
			scrollZoom={false}
			dragRotate={false}
			touchPitch={false}
			attributionControl={{ compact: true }}
			locale={{ "Map.Title": "Mapa de avisos en los corredores del Perú" }}
		>
			{routeColor && (
				<MapRoute
					coordinates={PANAMERICANA_NORTE_LIMA_PIURA}
					color={routeColor}
					width={HERO_ROUTE_WIDTH_PX}
					dashArray={HERO_ROUTE_DASH_ARRAY}
					interactive={false}
				/>
			)}
			{HERO_HAZARDS.map((hazard) => (
				<MapMarker
					key={hazard.name}
					longitude={hazard.longitude}
					latitude={hazard.latitude}
				>
					<MarkerContent>
						<span
							role="img"
							aria-label={`${hazard.name}, ${hazard.place}: ${INCIDENT_SEVERITY_LABELS[hazard.severity]}`}
						>
							<IncidentMarkerSymbol
								category={hazard.category}
								tone={INCIDENT_SEVERITY_TONES[hazard.severity]}
							/>
						</span>
					</MarkerContent>
					<MarkerTooltip>
						<div className="flex max-w-xs flex-col items-start gap-2">
							<SeverityBadge severity={hazard.severity} />
							<span className="type-body">{hazard.name}</span>
							<span className="type-body text-muted-foreground">
								{hazard.place}
							</span>
						</div>
					</MarkerTooltip>
				</MapMarker>
			))}
		</MapCanvas>
	);
}
