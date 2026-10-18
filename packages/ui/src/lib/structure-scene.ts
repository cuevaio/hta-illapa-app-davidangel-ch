import type {
	StructureKind,
	StructureMaterial,
	StructurePrimitiveKind,
	StructureStatus,
	TunnelSectionShape,
} from "@hack-the-andes-project/business/structures/catalog";
import type { CorridorLandmark } from "@hack-the-andes-project/business/structures/landmarks";
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

export type SceneCameraRequest =
	| { kind: "focus_structure"; structureId: string; requestId: number }
	| {
			kind: "frame_exposure";
			structureId: string;
			radiusM: number;
			requestId: number;
	  }
	| { kind: "focus_point"; point: GeoPoint; requestId: number }
	| { kind: "overview"; requestId: number }
	| { kind: "north_up"; requestId: number };

export type PrimitiveTarget = "selection" | "new_entity";

export type TransformMode = "translate" | "rotate" | "scale";

export interface SceneCursor {
	point: GeoPoint;
	elevationM: number;
	slopePercent: number;
}

export interface SceneInsets {
	topPx: number;
	rightPx: number;
	bottomPx: number;
	leftPx: number;
}

export interface SceneExposureRing {
	structureId: string;
	radiusM: number;
}

export interface SceneIncidentMarker {
	id: string;
	point: GeoPoint;
	severity: Incident["severity"];
	label: string;
}

export type TerrainStatus = "loading" | "ready" | "error";

export interface StructureSceneLabels {
	canvas: string;
	outsideTerrain: string;
	terrainError: string;
	span: string;
	heightDifference: string;
	length: string;
	slope: string;
	abutment: string;
	portal: string;
	point: string;
	placeTable: string;
	undo: string;
	exitXr: string;
}

export interface StructureSceneProps {
	origin: GeoPoint;
	structures: SceneStructure[];
	selectedStructureId: string | null;
	selectedElementId: string | null;
	hoveredStructureId: string | null;
	placementTool: PlacementTool | null;
	primitiveTarget: PrimitiveTarget;
	transformMode: TransformMode;
	cameraRequest: SceneCameraRequest | null;
	exposureRing: SceneExposureRing | null;
	incidentMarkers: SceneIncidentMarker[];
	landmarks: CorridorLandmark[];
	insets: SceneInsets;
	locale: string;
	xrStore: XRStore;
	labels: StructureSceneLabels;
	onCreateStructure: (placed: PlacedStructure) => void;
	onStructureChange: (structure: SceneStructure) => void;
	onSelectStructure: (structureId: string | null) => void;
	onSelectElement: (elementId: string | null) => void;
	onCursorChange: (cursor: SceneCursor | null) => void;
	onUndo: () => void;
	onTerrainStatusChange: (status: TerrainStatus) => void;
	className?: string;
}

export interface SceneXrRequest {
	requestId: number;
}

export interface BabylonStructureSceneProps
	extends Omit<StructureSceneProps, "xrStore"> {
	xrRequest: SceneXrRequest | null;
	onXrSupportChange: (supported: boolean) => void;
	onXrSessionChange: (active: boolean) => void;
}
