import type * as THREE from "three";

export interface CorridorRawPoint {
	lon: number;
	lat: number;
	km: number;
	elevationM: number;
}

export interface CorridorLandmark {
	name: string;
	km: number;
	lon: number;
	lat: number;
	elevationM: number;
}

export interface HazardSectionMetadata {
	fromKm: number;
	toKm: number;
	source: string;
	observedTime: string;
	validityHours: number;
	currentLabel: string;
	currentColor: string;
	currentSeverity: string;
	delayedHours: number;
	delayedLabel: string;
	delayedColor: string;
	delayedSeverity: string;
}

export interface Pe22CorridorData {
	id: string;
	name: string;
	roadCode: string;
	distanceM: number;
	durationS: number;
	hazardSection: HazardSectionMetadata;
	landmarks: CorridorLandmark[];
	points: CorridorRawPoint[];
}

export interface DetourCorridorData {
	id: string;
	name: string;
	source: string;
	color: string;
	distanceM: number;
	durationS: number;
	maxAxleCount: number;
	restriction: string;
	points: CorridorRawPoint[];
}

export interface CorridorSegmentProjection {
	lonA: number;
	latA: number;
	elevA: number;
	lonB: number;
	latB: number;
	elevB: number;
	deltaLon: number;
	deltaLat: number;
	lengthSq: number;
	weight: number;
}

export interface TableCoordinateXZ {
	positionX: number;
	positionZ: number;
}

export interface GeographicCoordinateLonLat {
	longitudeDegrees: number;
	latitudeDegrees: number;
}

export interface ProjectedLandmarkMarker {
	name: string;
	km: number;
	elevationM: number;
	position: THREE.Vector3;
}

export interface ProjectedPointAtKm {
	position: THREE.Vector3;
	tangent: THREE.Vector3;
	normal: THREE.Vector3;
	longitudeDegrees: number;
	latitudeDegrees: number;
}

export interface RouteCorridors {
	pe22Metadata: Pe22CorridorData;
	detourMetadata: DetourCorridorData;
	normalSegmentInitial: THREE.Vector3[];
	hazardSegment: THREE.Vector3[];
	normalSegmentTerminal: THREE.Vector3[];
	delayedHazardSegment: THREE.Vector3[];
	detourPoints: THREE.Vector3[];
	landmarks: ProjectedLandmarkMarker[];
}

export interface FloatingCardController {
	group: THREE.Group;
	cardMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
	targetRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
	setHighlight: (isHighlighted: boolean) => void;
	faceCamera: (cameraWorldPosition: THREE.Vector3) => void;
}

export interface AnimatedFlowTextureItem {
	texture: THREE.CanvasTexture;
	speedFactor: number;
}

export interface SceneElementsResult {
	rootGroup: THREE.Group;
	hazardMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
	floatingCard: FloatingCardController;
	updateAnimations: (
		deltaSeconds: number,
		elapsedSeconds: number,
		isReducedMotion: boolean,
	) => void;
}

export interface CameraPreset {
	position: THREE.Vector3;
	target: THREE.Vector3;
}

export interface SettlementClusterConfig {
	kilometerMark: number;
	houseCount: number;
	spreadRadiusMeters: number;
	isCoastalZone: boolean;
}

export interface HousePlacementItem {
	positionX: number;
	positionY: number;
	positionZ: number;
	rotationYRad: number;
	scaleWidth: number;
	scaleHeight: number;
	scaleDepth: number;
	isCoastalZone: boolean;
}

export interface TreePlacementItem {
	positionX: number;
	positionY: number;
	positionZ: number;
	uniformScale: number;
}

export interface RainStreakMetadataItem {
	baseX: number;
	baseZ: number;
	minY: number;
	phaseOffset: number;
	streakLengthMeters: number;
}

export interface TerrainEdgeSample {
	positionX: number;
	positionY: number;
	positionZ: number;
}

export interface LandmarkLabelOffset {
	offsetX: number;
	offsetY: number;
	offsetZ: number;
}
