import type { Terrain } from "@hack-the-andes-project/terrain/types";
import { Html } from "@react-three/drei";
import { Info, TriangleAlert } from "lucide-react";
import type { SceneIncidentMarker } from "../../lib/structure-scene";
import {
	INCIDENT_INK_TOKEN_NAMES,
	INCIDENT_LABEL_Z_INDEX,
	INCIDENT_TOKEN_NAMES,
	MARKER_LIFT_M,
} from "./constants";
import type { ScenePalette } from "./structure-model";

interface IncidentMarkerProps {
	marker: SceneIncidentMarker;
	terrain: Terrain;
	palette: ScenePalette;
}
export function IncidentMarker({
	marker,
	terrain,
	palette,
}: IncidentMarkerProps) {
	const local = terrain.toLocal(marker.point);
	const elevationM = terrain.heightAt(local);
	if (elevationM === null) return null;
	const Icon = marker.severity === "info" ? Info : TriangleAlert;
	return (
		<Html
			position={[local.x, elevationM + MARKER_LIFT_M, local.z]}
			center
			pointerEvents="none"
			zIndexRange={[INCIDENT_LABEL_Z_INDEX, INCIDENT_LABEL_Z_INDEX]}
			style={{ pointerEvents: "none" }}
		>
			<div
				className="type-data inline-flex w-max items-center gap-1 whitespace-nowrap rounded-full border-2 px-2 py-1"
				style={{
					backgroundColor: palette.color(INCIDENT_TOKEN_NAMES[marker.severity]),
					color: palette.color(INCIDENT_INK_TOKEN_NAMES[marker.severity]),
					borderColor: palette.color("--card"),
				}}
			>
				<Icon aria-hidden="true" className="size-4 shrink-0" />
				<span className="block">{marker.label}</span>
			</div>
		</Html>
	);
}
