import type {
	StructureKind,
	StructureMaterial,
	StructurePrimitiveKind,
	StructureStatus,
	TunnelSectionShape,
} from "@hack-the-andes-project/business/structures/catalog";
import type { GeoPoint } from "@hack-the-andes-project/terrain/types";
import type { XRStore } from "@react-three/xr";
import type { Incident } from "./incident";

export interface StructurePoint {
	x: number;
	y: number;
	z: number;
}

export interface StructureAnchor extends GeoPoint {
	elevationM: number;
}

export interface BridgeTemplate {
	kind: "bridge";
	start: StructurePoint;
	end: StructurePoint;
	deckWidthM: number;
	pierCount: number;
	deckMaterial: StructureMaterial;
}

export interface TunnelTemplate {
	kind: "tunnel";
	start: StructurePoint;
	end: StructurePoint;
	sectionWidthM: number;
	sectionHeightM: number;
	shape: TunnelSectionShape;
}

export interface BypassTemplate {
	kind: "bypass";
	points: StructurePoint[];
	laneCount: number;
	laneWidthM: number;
}

export interface EntityTemplate {
	kind: "entity";
}

export type StructureTemplate =
	| BridgeTemplate
	| TunnelTemplate
	| BypassTemplate
	| EntityTemplate;

export interface StructureElement {
	id: string;
	kind: StructurePrimitiveKind;
	material: StructureMaterial;
	position: StructurePoint;
	rotationDeg: StructurePoint;
	widthM: number;
	heightM: number;
	depthM: number;
}

export interface SceneStructure {
	id: string;
	name: string;
	status: StructureStatus;
	notes: string;
	anchor: StructureAnchor;
	template: StructureTemplate;
	elements: StructureElement[];
}

export interface PlacedStructure {
	anchor: StructureAnchor;
	template: StructureTemplate;
	elements: StructureElement[];
}

export type PlacementTool =
	| { kind: Exclude<StructureKind, "entity"> }
	| { primitive: StructurePrimitiveKind };

export interface SceneFocusRequest {
	structureId: string;
	requestId: number;
}

export interface SceneIncidentMarker {
	id: string;
	point: GeoPoint;
	severity: Incident["severity"];
	label: string;
}

export type TerrainStatus = "loading" | "ready" | "error";

export interface StructureSceneLabels {
	placementHint: string;
	cancelPlacement: string;
	undo: string;
	exitXr: string;
	terrainAttribution: string;
}

export interface StructureSceneProps {
	origin: GeoPoint;
	structures: SceneStructure[];
	selectedStructureId: string | null;
	selectedElementId: string | null;
	placementTool: PlacementTool | null;
	focusRequest: SceneFocusRequest | null;
	incidentMarkers: SceneIncidentMarker[];
	xrStore: XRStore;
	labels: StructureSceneLabels;
	onCreateStructure: (placed: PlacedStructure) => void;
	onStructureChange: (structure: SceneStructure) => void;
	onSelectStructure: (structureId: string | null) => void;
	onSelectElement: (elementId: string | null) => void;
	onCancelPlacement: () => void;
	onUndo: () => void;
	onTerrainStatusChange: (status: TerrainStatus) => void;
	className?: string;
}
