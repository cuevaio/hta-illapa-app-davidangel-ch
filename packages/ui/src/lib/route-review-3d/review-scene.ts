import type { RouteRiskHorizon } from "@hack-the-andes-project/business/route-review/risk";
import type { LineString } from "geojson";
import * as THREE from "three";

import type { RouteReviewCandidate } from "../route-review";
import {
	BASE_PLINTH_HEIGHT_M,
	BASE_PLINTH_PADDING_M,
	BRAND_TEAL_COLOR,
	CRITICAL_RED_COLOR,
	DEFAULT_PIN_FONT_SIZE_PX,
	HAZARD_ROAD_LIFT_M,
	HAZARD_ROAD_WIDTH_M,
	HIGH_ORANGE_COLOR,
	LOW_GREEN_COLOR,
	MODERATE_YELLOW_COLOR,
	NORMAL_ROAD_LIFT_M,
	NORMAL_ROAD_WIDTH_M,
	PLACE_PIN_LABEL_OFFSET_M,
	SURFACE_WHITE_COLOR,
	TERRAIN_SAND_COLOR,
	TERRAIN_SEGMENTS_X_COUNT,
	TERRAIN_SEGMENTS_Z_COUNT,
	TERRAIN_SKIRT_COLOR,
	TEXT_DARK_COLOR,
	TEXT_MUTED_COLOR,
} from "./constants";
import { getTerrainHeightAtXZ, projectCoordinate } from "./route";
import { buildRibbonMesh, createCalloutPin } from "./scene";
import type { TableFrame, TerrainEdgeSample } from "./types";

const RISK_RIBBON_COLORS = {
	low: LOW_GREEN_COLOR,
	moderate: MODERATE_YELLOW_COLOR,
	high: HIGH_ORANGE_COLOR,
	critical: CRITICAL_RED_COLOR,
} as const;

const UNSELECTED_RIBBON_RENDER_ORDER = 1;
const SELECTED_RIBBON_RENDER_ORDER = 2;

export interface RouteReviewTablePlace {
	name: string;
	longitudeDegrees: number;
	latitudeDegrees: number;
}

export interface RouteReviewTableInput {
	frame: TableFrame;
	candidates: readonly RouteReviewCandidate[];
	selectedCandidateId: string | null;
	horizon: RouteRiskHorizon;
	origin: RouteReviewTablePlace;
	destination: RouteReviewTablePlace;
}

export interface RouteReviewTableScene {
	rootGroup: THREE.Group;
	selectableMeshes: THREE.Mesh[];
	selectedFocus: THREE.Vector3;
}

function projectLine(
	coordinates: LineString["coordinates"],
	frame: TableFrame,
): THREE.Vector3[] {
	const points: THREE.Vector3[] = [];
	for (const position of coordinates) {
		const longitudeDegrees = position[0];
		const latitudeDegrees = position[1];
		if (longitudeDegrees === undefined || latitudeDegrees === undefined) {
			continue;
		}
		points.push(projectCoordinate(longitudeDegrees, latitudeDegrees, frame));
	}
	return points;
}

function averagePoint(points: readonly THREE.Vector3[]): THREE.Vector3 | null {
	if (points.length === 0) return null;
	const sum = new THREE.Vector3();
	for (const point of points) {
		sum.add(point);
	}
	return sum.multiplyScalar(1 / points.length);
}

function addRibbon(
	parent: THREE.Group,
	selectableMeshes: THREE.Mesh[],
	points: THREE.Vector3[],
	candidateId: string,
	color: string,
	widthMeters: number,
	liftMeters: number,
	renderOrder: number,
): void {
	if (points.length < 2) return;
	const { mesh } = buildRibbonMesh(points, widthMeters, color, liftMeters);
	mesh.userData.candidateId = candidateId;
	mesh.renderOrder = renderOrder;
	parent.add(mesh);
	selectableMeshes.push(mesh);
}

function appendSkirtWall(
	edgeSamples: TerrainEdgeSample[],
	skirtPositions: number[],
	skirtIndices: number[],
): void {
	const startVertexIndex = skirtPositions.length / 3;
	for (let sampleIndex = 0; sampleIndex < edgeSamples.length; sampleIndex++) {
		const sample = edgeSamples[sampleIndex];
		if (!sample) continue;
		skirtPositions.push(sample.positionX, sample.positionY, sample.positionZ);
		skirtPositions.push(sample.positionX, 0, sample.positionZ);
		if (sampleIndex < edgeSamples.length - 1) {
			const currentVertex = startVertexIndex + sampleIndex * 2;
			skirtIndices.push(currentVertex, currentVertex + 1, currentVertex + 2);
			skirtIndices.push(
				currentVertex + 1,
				currentVertex + 3,
				currentVertex + 2,
			);
		}
	}
}

function buildReviewTerrain(frame: TableFrame): THREE.Group {
	const terrainGroup = new THREE.Group();
	const planeGeometry = new THREE.PlaneGeometry(
		frame.widthMeters,
		frame.depthMeters,
		TERRAIN_SEGMENTS_X_COUNT,
		TERRAIN_SEGMENTS_Z_COUNT,
	);
	planeGeometry.rotateX(-Math.PI / 2);
	const positionAttribute = planeGeometry.attributes.position;
	if (positionAttribute) {
		for (
			let vertexIndex = 0;
			vertexIndex < positionAttribute.count;
			vertexIndex++
		) {
			const positionX = positionAttribute.getX(vertexIndex);
			const positionZ = positionAttribute.getZ(vertexIndex);
			positionAttribute.setY(
				vertexIndex,
				getTerrainHeightAtXZ(positionX, positionZ, frame),
			);
		}
	}
	planeGeometry.computeVertexNormals();
	const terrainMesh = new THREE.Mesh(
		planeGeometry,
		new THREE.MeshStandardMaterial({
			color: new THREE.Color(TERRAIN_SAND_COLOR),
			roughness: 0.9,
			metalness: 0.02,
		}),
	);
	terrainGroup.add(terrainMesh);

	const skirtPositions: number[] = [];
	const skirtIndices: number[] = [];
	const northEdge: TerrainEdgeSample[] = [];
	const southEdge: TerrainEdgeSample[] = [];
	for (
		let segmentIndexX = 0;
		segmentIndexX <= TERRAIN_SEGMENTS_X_COUNT;
		segmentIndexX++
	) {
		const positionX =
			(-0.5 + segmentIndexX / TERRAIN_SEGMENTS_X_COUNT) * frame.widthMeters;
		const northZ = -0.5 * frame.depthMeters;
		const southZ = 0.5 * frame.depthMeters;
		northEdge.push({
			positionX,
			positionY: getTerrainHeightAtXZ(positionX, northZ, frame),
			positionZ: northZ,
		});
		southEdge.push({
			positionX,
			positionY: getTerrainHeightAtXZ(positionX, southZ, frame),
			positionZ: southZ,
		});
	}
	const westEdge: TerrainEdgeSample[] = [];
	const eastEdge: TerrainEdgeSample[] = [];
	for (
		let segmentIndexZ = 0;
		segmentIndexZ <= TERRAIN_SEGMENTS_Z_COUNT;
		segmentIndexZ++
	) {
		const positionZ =
			(-0.5 + segmentIndexZ / TERRAIN_SEGMENTS_Z_COUNT) * frame.depthMeters;
		const westX = -0.5 * frame.widthMeters;
		const eastX = 0.5 * frame.widthMeters;
		westEdge.push({
			positionX: westX,
			positionY: getTerrainHeightAtXZ(westX, positionZ, frame),
			positionZ,
		});
		eastEdge.push({
			positionX: eastX,
			positionY: getTerrainHeightAtXZ(eastX, positionZ, frame),
			positionZ,
		});
	}
	appendSkirtWall(northEdge, skirtPositions, skirtIndices);
	appendSkirtWall(southEdge, skirtPositions, skirtIndices);
	appendSkirtWall(westEdge, skirtPositions, skirtIndices);
	appendSkirtWall(eastEdge, skirtPositions, skirtIndices);
	const skirtGeometry = new THREE.BufferGeometry();
	skirtGeometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(skirtPositions, 3),
	);
	skirtGeometry.setIndex(skirtIndices);
	skirtGeometry.computeVertexNormals();
	terrainGroup.add(
		new THREE.Mesh(
			skirtGeometry,
			new THREE.MeshStandardMaterial({
				color: new THREE.Color(TERRAIN_SKIRT_COLOR),
				roughness: 0.85,
				metalness: 0.04,
				side: THREE.DoubleSide,
			}),
		),
	);

	const plinth = new THREE.Mesh(
		new THREE.BoxGeometry(
			frame.widthMeters + BASE_PLINTH_PADDING_M,
			BASE_PLINTH_HEIGHT_M,
			frame.depthMeters + BASE_PLINTH_PADDING_M,
		),
		new THREE.MeshStandardMaterial({
			color: new THREE.Color(TEXT_DARK_COLOR),
			roughness: 0.65,
			metalness: 0.12,
		}),
	);
	plinth.position.set(0, -BASE_PLINTH_HEIGHT_M / 2, 0);
	terrainGroup.add(plinth);
	return terrainGroup;
}

function addPlacePin(
	parent: THREE.Group,
	frame: TableFrame,
	place: RouteReviewTablePlace,
	labelOffsetX: number,
): void {
	const anchor = projectCoordinate(
		place.longitudeDegrees,
		place.latitudeDegrees,
		frame,
	);
	const labelPosition = anchor.clone();
	labelPosition.x += labelOffsetX;
	labelPosition.y += PLACE_PIN_LABEL_OFFSET_M;
	labelPosition.z += labelOffsetX;
	parent.add(
		createCalloutPin(
			anchor,
			labelPosition,
			place.name,
			SURFACE_WHITE_COLOR,
			TEXT_DARK_COLOR,
			BRAND_TEAL_COLOR,
			DEFAULT_PIN_FONT_SIZE_PX,
		),
	);
}

export function buildRouteReviewTable(
	input: RouteReviewTableInput,
): RouteReviewTableScene {
	const rootGroup = new THREE.Group();
	const selectableMeshes: THREE.Mesh[] = [];
	const selectedPoints: THREE.Vector3[] = [];
	rootGroup.add(buildReviewTerrain(input.frame));

	for (const candidate of input.candidates) {
		const isVisible =
			candidate.eligibility.eligible ||
			candidate.id === input.selectedCandidateId;
		if (!isVisible) continue;
		const isSelected = candidate.id === input.selectedCandidateId;
		if (
			isSelected &&
			candidate.eligibility.eligible &&
			candidate.segments.length > 0
		) {
			for (const segment of candidate.segments) {
				const points = projectLine(segment.geometry.coordinates, input.frame);
				const assessment = segment.risk.find(
					(item) => item.horizon === input.horizon,
				);
				addRibbon(
					rootGroup,
					selectableMeshes,
					points,
					candidate.id,
					assessment ? RISK_RIBBON_COLORS[assessment.level] : TEXT_MUTED_COLOR,
					HAZARD_ROAD_WIDTH_M,
					HAZARD_ROAD_LIFT_M,
					SELECTED_RIBBON_RENDER_ORDER,
				);
				for (const point of points) {
					selectedPoints.push(point);
				}
			}
			continue;
		}

		const points = projectLine(candidate.geometry.coordinates, input.frame);
		const assessment = candidate.risk.find(
			(item) => item.horizon === input.horizon,
		);
		let ribbonColor = TEXT_MUTED_COLOR;
		if (isSelected && assessment) {
			ribbonColor = RISK_RIBBON_COLORS[assessment.level];
		} else if (!isSelected && candidate.source === "sutran") {
			ribbonColor = BRAND_TEAL_COLOR;
		}
		addRibbon(
			rootGroup,
			selectableMeshes,
			points,
			candidate.id,
			ribbonColor,
			isSelected ? HAZARD_ROAD_WIDTH_M : NORMAL_ROAD_WIDTH_M,
			isSelected ? HAZARD_ROAD_LIFT_M : NORMAL_ROAD_LIFT_M,
			isSelected
				? SELECTED_RIBBON_RENDER_ORDER
				: UNSELECTED_RIBBON_RENDER_ORDER,
		);
		if (isSelected) {
			for (const point of points) {
				selectedPoints.push(point);
			}
		}
	}

	addPlacePin(rootGroup, input.frame, input.origin, -PLACE_PIN_LABEL_OFFSET_M);
	addPlacePin(
		rootGroup,
		input.frame,
		input.destination,
		PLACE_PIN_LABEL_OFFSET_M,
	);

	const selectedFocus =
		averagePoint(selectedPoints) ??
		new THREE.Vector3(0, getTerrainHeightAtXZ(0, 0, input.frame), 0);

	return { rootGroup, selectableMeshes, selectedFocus };
}

export function disposeSceneObject(object: THREE.Object3D): void {
	object.traverse((child) => {
		if (child instanceof THREE.Sprite) {
			if (child.material.map) child.material.map.dispose();
			child.material.dispose();
			return;
		}
		if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Line)) {
			return;
		}
		child.geometry.dispose();
		const materials = Array.isArray(child.material)
			? child.material
			: [child.material];
		for (const material of materials) {
			if ("map" in material && material.map instanceof THREE.Texture) {
				material.map.dispose();
			}
			material.dispose();
		}
	});
}
