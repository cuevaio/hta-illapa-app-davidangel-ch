import * as THREE from "three";

import {
	BASE_PLINTH_HEIGHT_M,
	BASE_PLINTH_PADDING_M,
	BILLBOARD_BORDER_WIDTH_PX,
	BILLBOARD_CORNER_RADIUS_PX,
	BILLBOARD_MARGIN_PX,
	BILLBOARD_PADDING_X_PX,
	BILLBOARD_PADDING_Y_PX,
	BILLBOARD_PIXEL_SCALE,
	BILLBOARD_WORLD_METER_PER_PX,
	BRAND_TEAL_COLOR,
	CALLOUT_DOT_HEIGHT_M,
	CALLOUT_DOT_RADIUS_M,
	CALLOUT_DOT_SEGMENTS_COUNT,
	CALLOUT_DOT_Y_OFFSET_M,
	CALLOUT_ELBOW_DROP_M,
	CALLOUT_LINE_END_DROP_M,
	CALLOUT_LINE_START_Y_OFFSET_M,
	CARD_CANVAS_HEIGHT_PX,
	CARD_CANVAS_WIDTH_PX,
	CARD_FLOAT_Y_OFFSET_M,
	CARD_HEIGHT_M,
	CARD_HIGHLIGHT_SCALE_FACTOR,
	CARD_RING_INNER_RADIUS_M,
	CARD_RING_OUTER_RADIUS_M,
	CARD_RING_SEGMENTS_COUNT,
	CARD_RING_Y_OFFSET_M,
	CARD_STEM_TOP_OVERLAP_M,
	CARD_TILT_ANGLE_RAD,
	CARD_WIDTH_M,
	CLOUD_PUFF_DEPTH_M,
	CLOUD_PUFF_HEIGHT_M,
	CLOUD_PUFF_WIDTH_M,
	CLOUD_SEGMENT_RATIOS,
	CLOUD_Y_OFFSET_ABOVE_RAIN_M,
	DEFAULT_BILLBOARD_FONT_SIZE_PX,
	DEFAULT_LANDMARK_OFFSET,
	DEFAULT_PIN_FONT_SIZE_PX,
	DELAYED_FLOW_SPEED,
	DELAYED_ROAD_LIFT_M,
	DELAYED_ROAD_WIDTH_M,
	DETOUR_FLOW_SPEED,
	DETOUR_LABEL_FONT_SIZE_PX,
	DETOUR_ROAD_LIFT_M,
	DETOUR_ROAD_WIDTH_M,
	DIVIDER_LINE_COLOR,
	DRAFTING_MAT_INNER_BORDER_INSET_PX,
	DRAFTING_MAT_MARGIN_M,
	DRAFTING_MAT_OUTER_BORDER_INSET_PX,
	DRAFTING_MAT_SCALE_BAR_WIDTH_PX,
	DRAFTING_MAT_SURFACE_OFFSET_M,
	DRAFTING_MAT_TEX_WIDTH_PX,
	FLOW_RIBBON_BORDER_PX,
	FLOW_RIBBON_STRIPE_STEP_PX,
	FLOW_RIBBON_TEX_HEIGHT_PX,
	FLOW_RIBBON_TEX_WIDTH_PX,
	HAZARD_FLOW_SPEED,
	HAZARD_LABEL_FONT_SIZE_PX,
	HAZARD_ROAD_LIFT_M,
	HAZARD_ROAD_WIDTH_M,
	HIGH_ORANGE_COLOR,
	LANDMARK_OFFSETS,
	LCG_INCREMENT,
	LCG_MODULUS,
	LCG_MULTIPLIER,
	MAX_ELEVATION_M,
	MAX_LAT_DEG,
	MAX_LON_DEG,
	MIN_LAT_DEG,
	MIN_LON_DEG,
	MIN_SEGMENT_LENGTH_SQ,
	MODERATE_YELLOW_COLOR,
	NORMAL_ROAD_COLOR,
	NORMAL_ROAD_LIFT_M,
	NORMAL_ROAD_WIDTH_M,
	PARALLEL_BRIDGE_STEPS_COUNT,
	PARALLEL_BRIDGE_Y_OFFSET_M,
	QUEBRADA_KILOMETER_MARKS,
	RADAR_PULSE_AMPLITUDE,
	RADAR_PULSE_FREQUENCY_RAD_S,
	RAIN_BAND_HEIGHT_M,
	RAIN_FALL_SPEED_FACTOR,
	RAIN_MIN_STREAK_LENGTH_M,
	RAIN_MIN_Y_OFFSET_M,
	RAIN_SLANT_X_M,
	RAIN_SPREAD_M,
	RAIN_STREAK_COUNT,
	RAIN_VARIATION_STREAK_LENGTH_M,
	RIBBON_SKIRT_DEPTH_M,
	RIBBON_UV_REPEAT_PER_METER,
	RING_PULSE_AMPLITUDE,
	RING_PULSE_FREQUENCY_RAD_S,
	RISK_INK_DARK_COLOR,
	RNG_DEFAULT_SEED,
	RNG_RAIN_SEED,
	RNG_SETTLEMENT_SEED,
	SENAMHI_LATERAL_OFFSET_M,
	SENAMHI_STATION_KM,
	SETTLEMENT_CLUSTERS,
	SURFACE_WHITE_COLOR,
	TABLE_DEPTH_M,
	TABLE_WIDTH_M,
	TERRAIN_SEGMENTS_X_COUNT,
	TERRAIN_SEGMENTS_Z_COUNT,
	TERRAIN_TEX_HEIGHT_PX,
	TERRAIN_TEX_WIDTH_PX,
	TEXT_DARK_COLOR,
	TEXT_MUTED_COLOR,
	TEXT_SECONDARY_COLOR,
	TICLIO_ARCH_KM,
	TOPO_CONTOUR_MIN_ELEVATION_M,
	TOPO_GRID_COLUMNS_COUNT,
	TOPO_GRID_ROWS_COUNT,
	TOPO_HUAROCHIRI_END_KM,
	TOPO_HUAROCHIRI_START_KM,
	TOPO_MAJOR_CONTOUR_BAND_M,
	TOPO_MAJOR_CONTOUR_INTERVAL_M,
	TOPO_MINOR_CONTOUR_BAND_M,
	TOPO_MINOR_CONTOUR_INTERVAL_M,
	TOPO_SHORE_ELEVATION_M,
	TREE_CLUSTER_KILOMETER_MARKS,
	TREES_PER_CLUSTER_COUNT,
} from "./constants";
import {
	getPointAtPe22Km,
	getTerrainHeightAtXZ,
	sampleTerrainElevationMeters,
} from "./route";
import type {
	AnimatedFlowTextureItem,
	CorridorRawPoint,
	FloatingCardController,
	HousePlacementItem,
	RainStreakMetadataItem,
	RouteCorridors,
	SceneElementsResult,
	TerrainEdgeSample,
	TreePlacementItem,
} from "./types";

function createDeterministicRng(seedValue = RNG_DEFAULT_SEED): () => number {
	let generatorState = seedValue >>> 0;
	return () => {
		generatorState =
			(Math.imul(generatorState, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
		return generatorState / LCG_MODULUS;
	};
}

function createFlowRibbonTexture(
	baseColorHex: string,
	stripeColorHex: string,
): THREE.CanvasTexture {
	const canvasElement = document.createElement("canvas");
	canvasElement.width = FLOW_RIBBON_TEX_WIDTH_PX;
	canvasElement.height = FLOW_RIBBON_TEX_HEIGHT_PX;
	const context = canvasElement.getContext("2d");

	if (context) {
		context.fillStyle = baseColorHex;
		context.fillRect(0, 0, canvasElement.width, canvasElement.height);

		context.fillStyle = "rgba(10, 37, 48, 0.28)";
		context.fillRect(0, 0, canvasElement.width, FLOW_RIBBON_BORDER_PX);
		context.fillRect(
			0,
			canvasElement.height - FLOW_RIBBON_BORDER_PX,
			canvasElement.width,
			FLOW_RIBBON_BORDER_PX,
		);

		context.fillStyle = stripeColorHex;
		for (
			let stripeOffsetX = 0;
			stripeOffsetX < canvasElement.width;
			stripeOffsetX += FLOW_RIBBON_STRIPE_STEP_PX
		) {
			context.beginPath();
			context.moveTo(stripeOffsetX + 12, 18);
			context.lineTo(stripeOffsetX + 30, 32);
			context.lineTo(stripeOffsetX + 12, 46);
			context.lineTo(stripeOffsetX + 22, 46);
			context.lineTo(stripeOffsetX + 40, 32);
			context.lineTo(stripeOffsetX + 22, 18);
			context.closePath();
			context.fill();
		}
	}

	const texture = new THREE.CanvasTexture(canvasElement);
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

export function buildRibbonMesh(
	corridorPoints: THREE.Vector3[],
	ribbonWidthMeters: number,
	ribbonColorHex: string,
	elevationLiftMeters = NORMAL_ROAD_LIFT_M,
	stripeColorHex: string | null = null,
): {
	mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
	flowTexture: THREE.CanvasTexture | null;
} {
	const vertexPositions: number[] = [];
	const vertexUvs: number[] = [];
	const vertexIndices: number[] = [];
	const halfWidthMeters = ribbonWidthMeters / 2;
	let cumulativeDistanceMeters = 0;

	for (let pointIndex = 0; pointIndex < corridorPoints.length; pointIndex++) {
		const currentPoint = corridorPoints[pointIndex];
		if (!currentPoint) continue;

		const previousPoint =
			(pointIndex > 0 ? corridorPoints[pointIndex - 1] : currentPoint) ??
			currentPoint;
		const nextPoint =
			(pointIndex < corridorPoints.length - 1
				? corridorPoints[pointIndex + 1]
				: currentPoint) ?? currentPoint;

		if (pointIndex > 0) {
			cumulativeDistanceMeters += currentPoint.distanceTo(previousPoint);
		}

		const tangentVector = new THREE.Vector3().subVectors(
			nextPoint,
			previousPoint,
		);
		tangentVector.y = 0;
		if (tangentVector.lengthSq() < MIN_SEGMENT_LENGTH_SQ) {
			tangentVector.set(1, 0, 0);
		} else {
			tangentVector.normalize();
		}

		const normalVector = new THREE.Vector3(
			-tangentVector.z,
			0,
			tangentVector.x,
		);

		const leftX = currentPoint.x + normalVector.x * halfWidthMeters;
		const leftZ = currentPoint.z + normalVector.z * halfWidthMeters;
		const rightX = currentPoint.x - normalVector.x * halfWidthMeters;
		const rightZ = currentPoint.z - normalVector.z * halfWidthMeters;

		const terrainCenterY = getTerrainHeightAtXZ(currentPoint.x, currentPoint.z);
		const terrainLeftY = getTerrainHeightAtXZ(leftX, leftZ);
		const terrainRightY = getTerrainHeightAtXZ(rightX, rightZ);
		const highestLocalTerrainY = Math.max(
			terrainCenterY,
			terrainLeftY,
			terrainRightY,
		);

		const topY = highestLocalTerrainY + elevationLiftMeters;
		const bottomLeftY =
			Math.min(terrainLeftY, highestLocalTerrainY) - RIBBON_SKIRT_DEPTH_M;
		const bottomRightY =
			Math.min(terrainRightY, highestLocalTerrainY) - RIBBON_SKIRT_DEPTH_M;

		vertexPositions.push(leftX, topY, leftZ);
		vertexPositions.push(rightX, topY, rightZ);
		vertexPositions.push(leftX, bottomLeftY, leftZ);
		vertexPositions.push(rightX, bottomRightY, rightZ);

		const uvCoordinateU = cumulativeDistanceMeters * RIBBON_UV_REPEAT_PER_METER;
		vertexUvs.push(uvCoordinateU, 0);
		vertexUvs.push(uvCoordinateU, 1);
		vertexUvs.push(uvCoordinateU, 0);
		vertexUvs.push(uvCoordinateU, 1);

		if (pointIndex < corridorPoints.length - 1) {
			const baseVertexIndex = pointIndex * 4;
			const nextVertexIndex = (pointIndex + 1) * 4;

			vertexIndices.push(baseVertexIndex, baseVertexIndex + 1, nextVertexIndex);
			vertexIndices.push(
				baseVertexIndex + 1,
				nextVertexIndex + 1,
				nextVertexIndex,
			);

			vertexIndices.push(
				baseVertexIndex + 2,
				baseVertexIndex,
				nextVertexIndex + 2,
			);
			vertexIndices.push(baseVertexIndex, nextVertexIndex, nextVertexIndex + 2);

			vertexIndices.push(
				baseVertexIndex + 1,
				baseVertexIndex + 3,
				nextVertexIndex + 1,
			);
			vertexIndices.push(
				baseVertexIndex + 3,
				nextVertexIndex + 3,
				nextVertexIndex + 1,
			);
		}
	}

	const ribbonGeometry = new THREE.BufferGeometry();
	ribbonGeometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(vertexPositions, 3),
	);
	ribbonGeometry.setAttribute(
		"uv",
		new THREE.Float32BufferAttribute(vertexUvs, 2),
	);
	ribbonGeometry.setIndex(vertexIndices);
	ribbonGeometry.computeVertexNormals();

	const flowTexture = stripeColorHex
		? createFlowRibbonTexture(ribbonColorHex, stripeColorHex)
		: null;

	const ribbonMaterial = new THREE.MeshStandardMaterial({
		color: flowTexture
			? new THREE.Color(SURFACE_WHITE_COLOR)
			: new THREE.Color(ribbonColorHex),
		map: flowTexture,
		roughness: 0.42,
		metalness: 0.06,
		side: THREE.DoubleSide,
	});

	const mesh = new THREE.Mesh(ribbonGeometry, ribbonMaterial);
	return { mesh, flowTexture };
}

function createTopographicTerrainTexture(
	pe22Points: CorridorRawPoint[],
): THREE.CanvasTexture {
	const canvasElement = document.createElement("canvas");
	canvasElement.width = TERRAIN_TEX_WIDTH_PX;
	canvasElement.height = TERRAIN_TEX_HEIGHT_PX;
	const context = canvasElement.getContext("2d");

	if (context) {
		const imageData = context.createImageData(
			canvasElement.width,
			canvasElement.height,
		);
		const pixelBuffer = imageData.data;

		const colorOcean = new THREE.Color("#BDD2D7");
		const colorShore = new THREE.Color("#E3DAC3");
		const colorLowSand = new THREE.Color("#DDD0B3");
		const colorMidSand = new THREE.Color("#CBB996");
		const colorHighSand = new THREE.Color("#BDA780");
		const colorPuna = new THREE.Color("#DDD6C7");
		const colorSnowCap = new THREE.Color("#F1F4F5");
		const colorMajorContour = new THREE.Color("#978565");
		const colorMinorContour = new THREE.Color("#B5A483");
		const sampledColor = new THREE.Color();

		for (let pixelY = 0; pixelY < canvasElement.height; pixelY++) {
			const normalizedV = pixelY / (canvasElement.height - 1);
			const latitudeDegrees =
				MAX_LAT_DEG - normalizedV * (MAX_LAT_DEG - MIN_LAT_DEG);

			for (let pixelX = 0; pixelX < canvasElement.width; pixelX++) {
				const normalizedU = pixelX / (canvasElement.width - 1);
				const longitudeDegrees =
					MIN_LON_DEG + normalizedU * (MAX_LON_DEG - MIN_LON_DEG);

				const elevationMeters = sampleTerrainElevationMeters(
					longitudeDegrees,
					latitudeDegrees,
				);
				const normalizedElevation = THREE.MathUtils.clamp(
					elevationMeters / MAX_ELEVATION_M,
					0,
					1,
				);

				if (elevationMeters < TOPO_SHORE_ELEVATION_M) {
					sampledColor.lerpColors(
						colorOcean,
						colorShore,
						elevationMeters / TOPO_SHORE_ELEVATION_M,
					);
				} else if (normalizedElevation < 0.16) {
					sampledColor.lerpColors(
						colorShore,
						colorLowSand,
						(normalizedElevation - 0.005) / 0.155,
					);
				} else if (normalizedElevation < 0.48) {
					sampledColor.lerpColors(
						colorLowSand,
						colorMidSand,
						(normalizedElevation - 0.16) / 0.32,
					);
				} else if (normalizedElevation < 0.78) {
					sampledColor.lerpColors(
						colorMidSand,
						colorHighSand,
						(normalizedElevation - 0.48) / 0.3,
					);
				} else if (normalizedElevation < 0.93) {
					sampledColor.lerpColors(
						colorHighSand,
						colorPuna,
						(normalizedElevation - 0.78) / 0.15,
					);
				} else {
					sampledColor.lerpColors(
						colorPuna,
						colorSnowCap,
						THREE.MathUtils.clamp((normalizedElevation - 0.93) / 0.09, 0, 1),
					);
				}

				if (elevationMeters > TOPO_CONTOUR_MIN_ELEVATION_M) {
					const majorContourModulo =
						elevationMeters % TOPO_MAJOR_CONTOUR_INTERVAL_M;
					const minorContourModulo =
						elevationMeters % TOPO_MINOR_CONTOUR_INTERVAL_M;
					if (majorContourModulo < TOPO_MAJOR_CONTOUR_BAND_M) {
						sampledColor.lerp(colorMajorContour, 0.42);
					} else if (minorContourModulo < TOPO_MINOR_CONTOUR_BAND_M) {
						sampledColor.lerp(colorMinorContour, 0.22);
					}
				}

				const pixelBufferOffset = (pixelY * canvasElement.width + pixelX) * 4;
				pixelBuffer[pixelBufferOffset] = Math.round(sampledColor.r * 255);
				pixelBuffer[pixelBufferOffset + 1] = Math.round(sampledColor.g * 255);
				pixelBuffer[pixelBufferOffset + 2] = Math.round(sampledColor.b * 255);
				pixelBuffer[pixelBufferOffset + 3] = 255;
			}
		}

		context.putImageData(imageData, 0, 0);

		const lonLatToCanvasPx = (
			longitudeDegrees: number,
			latitudeDegrees: number,
		): { canvasX: number; canvasY: number } => ({
			canvasX:
				((longitudeDegrees - MIN_LON_DEG) / (MAX_LON_DEG - MIN_LON_DEG)) *
				canvasElement.width,
			canvasY:
				((MAX_LAT_DEG - latitudeDegrees) / (MAX_LAT_DEG - MIN_LAT_DEG)) *
				canvasElement.height,
		});

		context.save();
		context.strokeStyle = "rgba(11, 110, 120, 0.38)";
		context.lineWidth = 4.5;
		context.lineCap = "round";
		context.lineJoin = "round";
		context.beginPath();
		pe22Points.forEach((corridorPoint, pointIndex) => {
			const { canvasX, canvasY } = lonLatToCanvasPx(
				corridorPoint.lon,
				corridorPoint.lat - 0.008,
			);
			if (pointIndex === 0) context.moveTo(canvasX, canvasY);
			else context.lineTo(canvasX, canvasY);
		});
		context.stroke();
		context.restore();

		const huarochiriZonePoints = pe22Points.filter(
			(corridorPoint) =>
				corridorPoint.km >= TOPO_HUAROCHIRI_START_KM &&
				corridorPoint.km <= TOPO_HUAROCHIRI_END_KM,
		);
		if (huarochiriZonePoints.length > 2) {
			context.save();
			context.strokeStyle = "rgba(217, 98, 0, 0.16)";
			context.lineWidth = 54;
			context.lineCap = "round";
			context.lineJoin = "round";
			context.beginPath();
			huarochiriZonePoints.forEach((corridorPoint, pointIndex) => {
				const { canvasX, canvasY } = lonLatToCanvasPx(
					corridorPoint.lon,
					corridorPoint.lat,
				);
				if (pointIndex === 0) context.moveTo(canvasX, canvasY);
				else context.lineTo(canvasX, canvasY);
			});
			context.stroke();
			context.restore();
		}

		context.save();
		context.strokeStyle = "rgba(180, 92, 30, 0.32)";
		context.lineWidth = 2.5;
		context.setLineDash([7, 5]);
		QUEBRADA_KILOMETER_MARKS.forEach((kilometerMark, quebradaIndex) => {
			const nearestPoint = pe22Points.find(
				(corridorPoint) => corridorPoint.km >= kilometerMark,
			);
			if (!nearestPoint) return;
			const { canvasX, canvasY } = lonLatToCanvasPx(
				nearestPoint.lon,
				nearestPoint.lat,
			);
			const lateralDirection = quebradaIndex % 2 === 0 ? -1 : 1;
			context.beginPath();
			context.moveTo(canvasX - 18, canvasY + lateralDirection * 52);
			context.quadraticCurveTo(
				canvasX - 6,
				canvasY + lateralDirection * 22,
				canvasX,
				canvasY,
			);
			context.stroke();
		});
		context.restore();

		const gridStepX = canvasElement.width / TOPO_GRID_COLUMNS_COUNT;
		const gridStepY = canvasElement.height / TOPO_GRID_ROWS_COUNT;
		context.strokeStyle = "rgba(10, 37, 48, 0.06)";
		context.lineWidth = 1.5;

		for (
			let gridCoordX = gridStepX;
			gridCoordX < canvasElement.width;
			gridCoordX += gridStepX
		) {
			context.beginPath();
			context.moveTo(gridCoordX, 0);
			context.lineTo(gridCoordX, canvasElement.height);
			context.stroke();
		}
		for (
			let gridCoordY = gridStepY;
			gridCoordY < canvasElement.height;
			gridCoordY += gridStepY
		) {
			context.beginPath();
			context.moveTo(0, gridCoordY);
			context.lineTo(canvasElement.width, gridCoordY);
			context.stroke();
		}
	}

	const texture = new THREE.CanvasTexture(canvasElement);
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.anisotropy = 8;
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

function createDraftingMatMesh(): THREE.Mesh<
	THREE.PlaneGeometry,
	THREE.MeshBasicMaterial
> {
	const matWidthMeters = TABLE_WIDTH_M + DRAFTING_MAT_MARGIN_M * 2;
	const matDepthMeters = TABLE_DEPTH_M + DRAFTING_MAT_MARGIN_M * 2;

	const canvasElement = document.createElement("canvas");
	canvasElement.width = DRAFTING_MAT_TEX_WIDTH_PX;
	canvasElement.height = Math.round(
		DRAFTING_MAT_TEX_WIDTH_PX * (matDepthMeters / matWidthMeters),
	);
	const context = canvasElement.getContext("2d");

	if (context) {
		context.clearRect(0, 0, canvasElement.width, canvasElement.height);

		const marginPxX = Math.round(
			(DRAFTING_MAT_MARGIN_M / matWidthMeters) * canvasElement.width,
		);
		const marginPxY = Math.round(
			(DRAFTING_MAT_MARGIN_M / matDepthMeters) * canvasElement.height,
		);

		context.strokeStyle = "rgba(10, 37, 48, 0.22)";
		context.lineWidth = 3;
		context.strokeRect(
			marginPxX - DRAFTING_MAT_INNER_BORDER_INSET_PX,
			marginPxY - DRAFTING_MAT_INNER_BORDER_INSET_PX,
			canvasElement.width -
				(marginPxX - DRAFTING_MAT_INNER_BORDER_INSET_PX) * 2,
			canvasElement.height -
				(marginPxY - DRAFTING_MAT_INNER_BORDER_INSET_PX) * 2,
		);

		context.strokeStyle = "rgba(11, 110, 120, 0.16)";
		context.lineWidth = 2;
		context.strokeRect(
			DRAFTING_MAT_OUTER_BORDER_INSET_PX,
			DRAFTING_MAT_OUTER_BORDER_INSET_PX,
			canvasElement.width - DRAFTING_MAT_OUTER_BORDER_INSET_PX * 2,
			canvasElement.height - DRAFTING_MAT_OUTER_BORDER_INSET_PX * 2,
		);

		context.fillStyle = TEXT_DARK_COLOR;
		context.font = '700 22px "JetBrains Mono Variable", monospace';
		context.textBaseline = "middle";

		context.textAlign = "left";
		context.fillText(
			"ILLAPA // MAQUETA TOPOGRÁFICA CORREDOR CENTRAL PE-22 · ESCALA 1:250 000",
			marginPxX,
			marginPxY / 2 - 4,
		);

		context.textAlign = "right";
		context.fillStyle = BRAND_TEAL_COLOR;
		context.fillText(
			"N ▲   77°08'W — 75°07'W · PERFIL ALTITUDINAL 0 A 4 818 MSNM",
			canvasElement.width - marginPxX,
			marginPxY / 2 - 4,
		);

		const bottomLabelY = canvasElement.height - marginPxY / 2 + 6;
		context.textAlign = "left";
		context.fillStyle = TEXT_DARK_COLOR;
		context.fillText(
			"◄ OESTE · COSTA PACÍFICO (LIMA 150 M)",
			marginPxX,
			bottomLabelY,
		);

		context.textAlign = "right";
		context.fillText(
			"ESTE · VALLE DEL MANTARO (HUANCAYO 3 250 M) ►",
			canvasElement.width - marginPxX,
			bottomLabelY,
		);

		const scaleBarCenterX = canvasElement.width / 2;
		context.strokeStyle = TEXT_DARK_COLOR;
		context.lineWidth = 3;
		context.beginPath();
		context.moveTo(
			scaleBarCenterX - DRAFTING_MAT_SCALE_BAR_WIDTH_PX / 2,
			bottomLabelY - 8,
		);
		context.lineTo(
			scaleBarCenterX - DRAFTING_MAT_SCALE_BAR_WIDTH_PX / 2,
			bottomLabelY + 4,
		);
		context.lineTo(
			scaleBarCenterX + DRAFTING_MAT_SCALE_BAR_WIDTH_PX / 2,
			bottomLabelY + 4,
		);
		context.lineTo(
			scaleBarCenterX + DRAFTING_MAT_SCALE_BAR_WIDTH_PX / 2,
			bottomLabelY - 8,
		);
		context.stroke();

		context.textAlign = "center";
		context.font = '700 20px "JetBrains Mono Variable", monospace';
		context.fillText(
			"0 ———— 50 KM ———— 100 KM",
			scaleBarCenterX,
			bottomLabelY - 12,
		);
	}

	const texture = new THREE.CanvasTexture(canvasElement);
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.anisotropy = 4;
	texture.colorSpace = THREE.SRGBColorSpace;

	const geometry = new THREE.PlaneGeometry(matWidthMeters, matDepthMeters);
	geometry.rotateX(-Math.PI / 2);
	const material = new THREE.MeshBasicMaterial({
		map: texture,
		transparent: true,
		depthWrite: false,
	});

	const mesh = new THREE.Mesh(geometry, material);
	mesh.position.y = -BASE_PLINTH_HEIGHT_M + DRAFTING_MAT_SURFACE_OFFSET_M;
	return mesh;
}

export function buildTerrain(pe22Points: CorridorRawPoint[]): THREE.Group {
	const terrainGroup = new THREE.Group();

	const planeGeometry = new THREE.PlaneGeometry(
		TABLE_WIDTH_M,
		TABLE_DEPTH_M,
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
			const posX = positionAttribute.getX(vertexIndex);
			const posZ = positionAttribute.getZ(vertexIndex);
			const heightY = getTerrainHeightAtXZ(posX, posZ);
			positionAttribute.setY(vertexIndex, heightY);
		}
	}
	planeGeometry.computeVertexNormals();

	const topoTexture = createTopographicTerrainTexture(pe22Points);
	const terrainMaterial = new THREE.MeshStandardMaterial({
		map: topoTexture,
		roughness: 0.9,
		metalness: 0.02,
	});

	const terrainMesh = new THREE.Mesh(planeGeometry, terrainMaterial);
	terrainGroup.add(terrainMesh);

	const skirtPositions: number[] = [];
	const skirtIndices: number[] = [];
	let skirtVertexCounter = 0;

	function appendSkirtWall(edgeSamples: TerrainEdgeSample[]): void {
		const startVertexIndex = skirtVertexCounter;
		for (let sampleIndex = 0; sampleIndex < edgeSamples.length; sampleIndex++) {
			const sample = edgeSamples[sampleIndex];
			if (!sample) continue;

			skirtPositions.push(sample.positionX, sample.positionY, sample.positionZ);
			skirtPositions.push(sample.positionX, 0, sample.positionZ);
			skirtVertexCounter += 2;

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

	const northEdge: TerrainEdgeSample[] = [];
	const southEdge: TerrainEdgeSample[] = [];
	for (
		let segmentIndexX = 0;
		segmentIndexX <= TERRAIN_SEGMENTS_X_COUNT;
		segmentIndexX++
	) {
		const positionX =
			(-0.5 + segmentIndexX / TERRAIN_SEGMENTS_X_COUNT) * TABLE_WIDTH_M;
		const zNorth = -0.5 * TABLE_DEPTH_M;
		const zSouth = 0.5 * TABLE_DEPTH_M;
		northEdge.push({
			positionX,
			positionY: getTerrainHeightAtXZ(positionX, zNorth),
			positionZ: zNorth,
		});
		southEdge.push({
			positionX,
			positionY: getTerrainHeightAtXZ(positionX, zSouth),
			positionZ: zSouth,
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
			(-0.5 + segmentIndexZ / TERRAIN_SEGMENTS_Z_COUNT) * TABLE_DEPTH_M;
		const xWest = -0.5 * TABLE_WIDTH_M;
		const xEast = 0.5 * TABLE_WIDTH_M;
		westEdge.push({
			positionX: xWest,
			positionY: getTerrainHeightAtXZ(xWest, positionZ),
			positionZ,
		});
		eastEdge.push({
			positionX: xEast,
			positionY: getTerrainHeightAtXZ(xEast, positionZ),
			positionZ,
		});
	}

	appendSkirtWall(northEdge);
	appendSkirtWall(southEdge.reverse());
	appendSkirtWall(westEdge.reverse());
	appendSkirtWall(eastEdge);

	const skirtGeometry = new THREE.BufferGeometry();
	skirtGeometry.setAttribute(
		"position",
		new THREE.Float32BufferAttribute(skirtPositions, 3),
	);
	skirtGeometry.setIndex(skirtIndices);
	skirtGeometry.computeVertexNormals();

	const skirtMaterial = new THREE.MeshStandardMaterial({
		color: new THREE.Color("#B5A584"),
		roughness: 0.85,
		metalness: 0.04,
		side: THREE.DoubleSide,
	});
	const skirtMesh = new THREE.Mesh(skirtGeometry, skirtMaterial);
	terrainGroup.add(skirtMesh);

	const basePlinthGeometry = new THREE.BoxGeometry(
		TABLE_WIDTH_M + BASE_PLINTH_PADDING_M,
		BASE_PLINTH_HEIGHT_M,
		TABLE_DEPTH_M + BASE_PLINTH_PADDING_M,
	);
	const basePlinthMaterial = new THREE.MeshStandardMaterial({
		color: new THREE.Color(TEXT_DARK_COLOR),
		roughness: 0.65,
		metalness: 0.12,
	});
	const basePlinthMesh = new THREE.Mesh(basePlinthGeometry, basePlinthMaterial);
	basePlinthMesh.position.set(0, -BASE_PLINTH_HEIGHT_M / 2, 0);
	terrainGroup.add(basePlinthMesh);

	const draftingMat = createDraftingMatMesh();
	terrainGroup.add(draftingMat);

	return terrainGroup;
}

function buildInstancedSettlementsAndDetails(corridors: RouteCorridors): {
	detailsGroup: THREE.Group;
	radarDish: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
} {
	const detailsGroup = new THREE.Group();
	const randomGenerator = createDeterministicRng(RNG_SETTLEMENT_SEED);

	const detourCantaAnchor =
		corridors.detourPoints[Math.floor(corridors.detourPoints.length * 0.22)];
	const detourHuayllayAnchor =
		corridors.detourPoints[Math.floor(corridors.detourPoints.length * 0.42)];

	const housePlacements: HousePlacementItem[] = [];

	SETTLEMENT_CLUSTERS.forEach((cluster) => {
		const centerInfo = getPointAtPe22Km(cluster.kilometerMark);
		for (let houseIndex = 0; houseIndex < cluster.houseCount; houseIndex++) {
			const lateralSide = houseIndex % 2 === 0 ? 1 : -1;
			const hazardLateralClearance =
				cluster.kilometerMark >= 70 &&
				cluster.kilometerMark <= 115 &&
				lateralSide > 0
					? 0.024
					: 0;
			const lateralDistance =
				0.012 +
				randomGenerator() * cluster.spreadRadiusMeters +
				hazardLateralClearance;
			const alongRoadDistance =
				(randomGenerator() - 0.5) * cluster.spreadRadiusMeters * 1.6;

			const positionX =
				centerInfo.position.x +
				centerInfo.normal.x * lateralSide * lateralDistance +
				centerInfo.tangent.x * alongRoadDistance;
			const positionZ =
				centerInfo.position.z +
				centerInfo.normal.z * lateralSide * lateralDistance +
				centerInfo.tangent.z * alongRoadDistance;

			if (
				Math.abs(positionX) < TABLE_WIDTH_M * 0.48 &&
				Math.abs(positionZ) < TABLE_DEPTH_M * 0.48
			) {
				const positionY = getTerrainHeightAtXZ(positionX, positionZ);
				housePlacements.push({
					positionX,
					positionY,
					positionZ,
					rotationYRad: randomGenerator() * Math.PI,
					scaleWidth: 0.8 + randomGenerator() * 0.65,
					scaleHeight: cluster.isCoastalZone
						? 0.9 + randomGenerator() * 1.1
						: 0.75 + randomGenerator() * 0.5,
					scaleDepth: 0.8 + randomGenerator() * 0.55,
					isCoastalZone: cluster.isCoastalZone,
				});
			}
		}
	});

	[detourCantaAnchor, detourHuayllayAnchor].forEach((anchorPoint) => {
		if (!anchorPoint) return;
		for (let houseIndex = 0; houseIndex < 12; houseIndex++) {
			const angleRadians = randomGenerator() * Math.PI * 2;
			const radialDistance = 0.012 + randomGenerator() * 0.02;
			const positionX = anchorPoint.x + Math.cos(angleRadians) * radialDistance;
			const positionZ = anchorPoint.z + Math.sin(angleRadians) * radialDistance;
			const positionY = getTerrainHeightAtXZ(positionX, positionZ);
			housePlacements.push({
				positionX,
				positionY,
				positionZ,
				rotationYRad: randomGenerator() * Math.PI,
				scaleWidth: 0.8 + randomGenerator() * 0.4,
				scaleHeight: 0.8 + randomGenerator() * 0.4,
				scaleDepth: 0.8 + randomGenerator() * 0.4,
				isCoastalZone: false,
			});
		}
	});

	const totalHousesCount = housePlacements.length;
	const wallGeometry = new THREE.BoxGeometry(0.0048, 0.0036, 0.0038);
	wallGeometry.translate(0, 0.0018, 0);
	const wallMaterial = new THREE.MeshStandardMaterial({
		color: new THREE.Color("#F4EFE4"),
		roughness: 0.82,
		metalness: 0.02,
	});
	const wallInstanced = new THREE.InstancedMesh(
		wallGeometry,
		wallMaterial,
		totalHousesCount,
	);

	const roofGeometry = new THREE.ConeGeometry(0.0039, 0.0024, 4);
	roofGeometry.rotateY(Math.PI / 4);
	roofGeometry.translate(0, 0.0046, 0);
	const roofMaterial = new THREE.MeshStandardMaterial({
		roughness: 0.72,
		metalness: 0.04,
	});
	const roofInstanced = new THREE.InstancedMesh(
		roofGeometry,
		roofMaterial,
		totalHousesCount,
	);

	const transformHelper = new THREE.Object3D();
	const colorTerracotta = new THREE.Color("#B85D3B");
	const colorTerracottaLight = new THREE.Color("#C9724E");
	const colorCoastalRoof = new THREE.Color("#8A999E");

	housePlacements.forEach((housePlacement, houseIndex) => {
		transformHelper.position.set(
			housePlacement.positionX,
			housePlacement.positionY,
			housePlacement.positionZ,
		);
		transformHelper.rotation.set(0, housePlacement.rotationYRad, 0);
		transformHelper.scale.set(
			housePlacement.scaleWidth,
			housePlacement.scaleHeight,
			housePlacement.scaleDepth,
		);
		transformHelper.updateMatrix();
		wallInstanced.setMatrixAt(houseIndex, transformHelper.matrix);

		transformHelper.scale.set(
			housePlacement.scaleWidth,
			housePlacement.isCoastalZone
				? housePlacement.scaleHeight * 0.35
				: housePlacement.scaleHeight,
			housePlacement.scaleDepth,
		);
		transformHelper.updateMatrix();
		roofInstanced.setMatrixAt(houseIndex, transformHelper.matrix);
		roofInstanced.setColorAt(
			houseIndex,
			housePlacement.isCoastalZone
				? colorCoastalRoof
				: houseIndex % 2 === 0
					? colorTerracotta
					: colorTerracottaLight,
		);
	});

	wallInstanced.instanceMatrix.needsUpdate = true;
	roofInstanced.instanceMatrix.needsUpdate = true;
	if (roofInstanced.instanceColor) {
		roofInstanced.instanceColor.needsUpdate = true;
	}

	detailsGroup.add(wallInstanced);
	detailsGroup.add(roofInstanced);

	const treePositions: TreePlacementItem[] = [];
	TREE_CLUSTER_KILOMETER_MARKS.forEach((kilometerMark) => {
		const pointInfo = getPointAtPe22Km(kilometerMark);
		for (let treeIndex = 0; treeIndex < TREES_PER_CLUSTER_COUNT; treeIndex++) {
			const lateralSide = treeIndex % 2 === 0 ? -1 : 1;
			const lateralDistance = 0.016 + randomGenerator() * 0.028;
			const alongRoadDistance = (randomGenerator() - 0.5) * 0.035;
			const positionX =
				pointInfo.position.x +
				pointInfo.normal.x * lateralSide * lateralDistance +
				pointInfo.tangent.x * alongRoadDistance;
			const positionZ =
				pointInfo.position.z +
				pointInfo.normal.z * lateralSide * lateralDistance +
				pointInfo.tangent.z * alongRoadDistance;
			const positionY = getTerrainHeightAtXZ(positionX, positionZ);
			treePositions.push({
				positionX,
				positionY,
				positionZ,
				uniformScale: 0.75 + randomGenerator() * 0.55,
			});
		}
	});

	const treeGeometry = new THREE.ConeGeometry(0.0026, 0.0085, 5);
	treeGeometry.translate(0, 0.0042, 0);
	const treeMaterial = new THREE.MeshStandardMaterial({
		color: new THREE.Color("#4E6E49"),
		roughness: 0.88,
	});
	const treeInstanced = new THREE.InstancedMesh(
		treeGeometry,
		treeMaterial,
		treePositions.length,
	);
	treePositions.forEach((treePlacement, treeIndex) => {
		transformHelper.position.set(
			treePlacement.positionX,
			treePlacement.positionY,
			treePlacement.positionZ,
		);
		transformHelper.rotation.set(0, treeIndex * 1.1, 0);
		transformHelper.scale.set(
			treePlacement.uniformScale,
			treePlacement.uniformScale,
			treePlacement.uniformScale,
		);
		transformHelper.updateMatrix();
		treeInstanced.setMatrixAt(treeIndex, transformHelper.matrix);
	});
	treeInstanced.instanceMatrix.needsUpdate = true;
	detailsGroup.add(treeInstanced);

	const senamhiInfo = getPointAtPe22Km(SENAMHI_STATION_KM);
	const stationGroup = new THREE.Group();
	const stationX =
		senamhiInfo.position.x - senamhiInfo.normal.x * SENAMHI_LATERAL_OFFSET_M;
	const stationZ =
		senamhiInfo.position.z - senamhiInfo.normal.z * SENAMHI_LATERAL_OFFSET_M;
	const stationY = getTerrainHeightAtXZ(stationX, stationZ);

	const stationBase = new THREE.Mesh(
		new THREE.BoxGeometry(0.009, 0.006, 0.009),
		new THREE.MeshStandardMaterial({
			color: new THREE.Color(SURFACE_WHITE_COLOR),
			roughness: 0.5,
		}),
	);
	stationBase.position.set(0, 0.003, 0);
	stationGroup.add(stationBase);

	const stationMast = new THREE.Mesh(
		new THREE.CylinderGeometry(0.0008, 0.0008, 0.022, 8),
		new THREE.MeshStandardMaterial({
			color: new THREE.Color(HIGH_ORANGE_COLOR),
		}),
	);
	stationMast.position.set(0, 0.011, 0);
	stationGroup.add(stationMast);

	const radarDish = new THREE.Mesh(
		new THREE.SphereGeometry(0.0032, 12, 8),
		new THREE.MeshStandardMaterial({
			color: new THREE.Color(HIGH_ORANGE_COLOR),
			roughness: 0.3,
		}),
	);
	radarDish.position.set(0, 0.022, 0);
	stationGroup.add(radarDish);

	stationGroup.position.set(stationX, stationY, stationZ);
	detailsGroup.add(stationGroup);

	const ticlioInfo = getPointAtPe22Km(TICLIO_ARCH_KM);
	const archGroup = new THREE.Group();
	const pillarGeometry = new THREE.BoxGeometry(0.0022, 0.016, 0.0022);
	const archMaterial = new THREE.MeshStandardMaterial({
		color: new THREE.Color(TEXT_DARK_COLOR),
		roughness: 0.5,
	});
	const leftPillar = new THREE.Mesh(pillarGeometry, archMaterial);
	leftPillar.position.set(-0.0065, 0.008, 0);
	const rightPillar = new THREE.Mesh(pillarGeometry, archMaterial);
	rightPillar.position.set(0.0065, 0.008, 0);
	const topBeam = new THREE.Mesh(
		new THREE.BoxGeometry(0.016, 0.0032, 0.003),
		new THREE.MeshStandardMaterial({
			color: new THREE.Color(BRAND_TEAL_COLOR),
		}),
	);
	topBeam.position.set(0, 0.016, 0);
	archGroup.add(leftPillar, rightPillar, topBeam);
	archGroup.position.copy(ticlioInfo.position);
	archGroup.rotation.y = Math.atan2(ticlioInfo.tangent.x, ticlioInfo.tangent.z);
	detailsGroup.add(archGroup);

	return { detailsGroup, radarDish };
}

function buildMayuRainSystem(hazardSegment: THREE.Vector3[]): {
	rainGroup: THREE.Group;
	updateRain: (elapsedSeconds: number) => void;
} {
	const rainGroup = new THREE.Group();
	const randomGenerator = createDeterministicRng(RNG_RAIN_SEED);

	const rainVertexPositions = new Float32Array(RAIN_STREAK_COUNT * 6);
	const streakMetadata: RainStreakMetadataItem[] = [];

	for (let streakIndex = 0; streakIndex < RAIN_STREAK_COUNT; streakIndex++) {
		const segmentIndex = Math.floor(randomGenerator() * hazardSegment.length);
		const roadPoint = hazardSegment[segmentIndex] ?? new THREE.Vector3(0, 0, 0);
		const baseX = roadPoint.x + (randomGenerator() - 0.5) * RAIN_SPREAD_M;
		const baseZ = roadPoint.z + (randomGenerator() - 0.5) * RAIN_SPREAD_M;
		const minY = roadPoint.y + RAIN_MIN_Y_OFFSET_M;
		const phaseOffset = randomGenerator();
		const streakLengthMeters =
			RAIN_MIN_STREAK_LENGTH_M +
			randomGenerator() * RAIN_VARIATION_STREAK_LENGTH_M;

		streakMetadata.push({
			baseX,
			baseZ,
			minY,
			phaseOffset,
			streakLengthMeters,
		});

		const currentY = minY + phaseOffset * RAIN_BAND_HEIGHT_M;
		const bufferOffset = streakIndex * 6;
		rainVertexPositions[bufferOffset] = baseX;
		rainVertexPositions[bufferOffset + 1] = currentY;
		rainVertexPositions[bufferOffset + 2] = baseZ;
		rainVertexPositions[bufferOffset + 3] = baseX - RAIN_SLANT_X_M;
		rainVertexPositions[bufferOffset + 4] = currentY - streakLengthMeters;
		rainVertexPositions[bufferOffset + 5] = baseZ;
	}

	const rainGeometry = new THREE.BufferGeometry();
	const positionAttribute = new THREE.BufferAttribute(rainVertexPositions, 3);
	rainGeometry.setAttribute("position", positionAttribute);
	const rainMaterial = new THREE.LineBasicMaterial({
		color: new THREE.Color("#2B7B8C"),
		transparent: true,
		opacity: 0.52,
	});
	const rainLines = new THREE.LineSegments(rainGeometry, rainMaterial);
	rainGroup.add(rainLines);

	const cloudGroup = new THREE.Group();
	const cloudMaterial = new THREE.MeshStandardMaterial({
		color: new THREE.Color("#DCE6E9"),
		roughness: 0.95,
		transparent: true,
		opacity: 0.82,
	});

	CLOUD_SEGMENT_RATIOS.forEach((segmentRatio) => {
		const segmentPoint =
			hazardSegment[Math.floor(hazardSegment.length * segmentRatio)];
		if (!segmentPoint) return;
		const cloudPuff = new THREE.Mesh(
			new THREE.BoxGeometry(
				CLOUD_PUFF_WIDTH_M,
				CLOUD_PUFF_HEIGHT_M,
				CLOUD_PUFF_DEPTH_M,
			),
			cloudMaterial,
		);
		cloudPuff.position.set(
			segmentPoint.x,
			segmentPoint.y + RAIN_BAND_HEIGHT_M + CLOUD_Y_OFFSET_ABOVE_RAIN_M,
			segmentPoint.z,
		);
		cloudGroup.add(cloudPuff);
	});
	rainGroup.add(cloudGroup);

	return {
		rainGroup,
		updateRain: (elapsedSeconds: number) => {
			for (
				let streakIndex = 0;
				streakIndex < RAIN_STREAK_COUNT;
				streakIndex++
			) {
				const streakItem = streakMetadata[streakIndex];
				if (!streakItem) continue;
				const fallProgress =
					(streakItem.phaseOffset + elapsedSeconds * RAIN_FALL_SPEED_FACTOR) %
					1;
				const topY = streakItem.minY + (1 - fallProgress) * RAIN_BAND_HEIGHT_M;
				const bufferOffset = streakIndex * 6;
				rainVertexPositions[bufferOffset + 1] = topY;
				rainVertexPositions[bufferOffset + 4] =
					topY - streakItem.streakLengthMeters;
			}
			positionAttribute.needsUpdate = true;
		},
	};
}

export function createTextBillboard(
	labelText: string,
	backgroundColorHex: string,
	textColorHex: string,
	borderColorHex = textColorHex,
	fontSizePixels = DEFAULT_BILLBOARD_FONT_SIZE_PX,
): THREE.Sprite {
	const measureCanvas = document.createElement("canvas");
	const measureContext = measureCanvas.getContext("2d");
	const scaledFontSize = fontSizePixels * BILLBOARD_PIXEL_SCALE;
	const fontSpecification = `700 ${scaledFontSize}px "Archivo Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;

	let textWidthPx = scaledFontSize * labelText.length * 0.55;
	if (measureContext) {
		measureContext.font = fontSpecification;
		textWidthPx = Math.ceil(measureContext.measureText(labelText).width);
	}

	const horizontalPaddingPx = BILLBOARD_PADDING_X_PX * BILLBOARD_PIXEL_SCALE;
	const verticalPaddingPx = BILLBOARD_PADDING_Y_PX * BILLBOARD_PIXEL_SCALE;

	const canvasWidth = textWidthPx + horizontalPaddingPx * 2;
	const canvasHeight = scaledFontSize + verticalPaddingPx * 2;

	const canvasElement = document.createElement("canvas");
	canvasElement.width = canvasWidth;
	canvasElement.height = canvasHeight;
	const context = canvasElement.getContext("2d");

	if (context) {
		const marginPx = BILLBOARD_MARGIN_PX * BILLBOARD_PIXEL_SCALE;
		const cornerRadiusPx = BILLBOARD_CORNER_RADIUS_PX * BILLBOARD_PIXEL_SCALE;

		context.fillStyle = backgroundColorHex;
		context.beginPath();
		context.roundRect(
			marginPx,
			marginPx,
			canvasWidth - marginPx * 2,
			canvasHeight - marginPx * 2,
			cornerRadiusPx,
		);
		context.fill();

		context.strokeStyle = borderColorHex;
		context.lineWidth = BILLBOARD_BORDER_WIDTH_PX * BILLBOARD_PIXEL_SCALE;
		context.stroke();

		context.fillStyle = textColorHex;
		context.font = fontSpecification;
		context.textAlign = "center";
		context.textBaseline = "middle";
		context.fillText(labelText, canvasWidth / 2, canvasHeight / 2 + 1);
	}

	const texture = new THREE.CanvasTexture(canvasElement);
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.colorSpace = THREE.SRGBColorSpace;

	const spriteMaterial = new THREE.SpriteMaterial({
		map: texture,
		transparent: true,
		depthTest: true,
	});
	const sprite = new THREE.Sprite(spriteMaterial);

	const worldWidth =
		(canvasWidth / BILLBOARD_PIXEL_SCALE) * BILLBOARD_WORLD_METER_PER_PX;
	const worldHeight =
		(canvasHeight / BILLBOARD_PIXEL_SCALE) * BILLBOARD_WORLD_METER_PER_PX;
	sprite.scale.set(worldWidth, worldHeight, 1);

	return sprite;
}

export function createCalloutPin(
	anchorPosition: THREE.Vector3,
	labelPosition: THREE.Vector3,
	labelText: string,
	backgroundColorHex: string,
	textColorHex: string,
	borderColorHex: string,
	fontSizePixels = DEFAULT_PIN_FONT_SIZE_PX,
): THREE.Group {
	const group = new THREE.Group();

	const dotGeometry = new THREE.CylinderGeometry(
		CALLOUT_DOT_RADIUS_M,
		CALLOUT_DOT_RADIUS_M,
		CALLOUT_DOT_HEIGHT_M,
		CALLOUT_DOT_SEGMENTS_COUNT,
	);
	const dotMaterial = new THREE.MeshBasicMaterial({
		color: new THREE.Color(borderColorHex),
	});
	const dotMesh = new THREE.Mesh(dotGeometry, dotMaterial);
	dotMesh.position.copy(anchorPosition);
	dotMesh.position.y += CALLOUT_DOT_Y_OFFSET_M;
	group.add(dotMesh);

	const elbowPoint = new THREE.Vector3(
		anchorPosition.x,
		labelPosition.y - CALLOUT_ELBOW_DROP_M,
		anchorPosition.z,
	);

	const lineGeometry = new THREE.BufferGeometry().setFromPoints([
		new THREE.Vector3(
			anchorPosition.x,
			anchorPosition.y + CALLOUT_LINE_START_Y_OFFSET_M,
			anchorPosition.z,
		),
		elbowPoint,
		new THREE.Vector3(
			labelPosition.x,
			labelPosition.y - CALLOUT_LINE_END_DROP_M,
			labelPosition.z,
		),
	]);
	const lineMaterial = new THREE.LineBasicMaterial({
		color: new THREE.Color(borderColorHex),
	});
	const line = new THREE.Line(lineGeometry, lineMaterial);
	group.add(line);

	const sprite = createTextBillboard(
		labelText,
		backgroundColorHex,
		textColorHex,
		borderColorHex,
		fontSizePixels,
	);
	sprite.position.copy(labelPosition);
	group.add(sprite);

	return group;
}

export function createFloatingCard(
	anchorPosition: THREE.Vector3,
): FloatingCardController {
	const cardGroup = new THREE.Group();

	const canvasElement = document.createElement("canvas");
	canvasElement.width = CARD_CANVAS_WIDTH_PX;
	canvasElement.height = CARD_CANVAS_HEIGHT_PX;
	const context = canvasElement.getContext("2d");

	function renderCard(isHighlighted = false): void {
		if (!context) return;
		context.clearRect(0, 0, canvasElement.width, canvasElement.height);

		context.fillStyle = SURFACE_WHITE_COLOR;
		context.beginPath();
		context.roundRect(
			16,
			16,
			canvasElement.width - 32,
			canvasElement.height - 32,
			28,
		);
		context.fill();

		context.fillStyle = HIGH_ORANGE_COLOR;
		context.beginPath();
		context.roundRect(16, 16, canvasElement.width - 32, 18, [28, 28, 0, 0]);
		context.fill();

		context.lineWidth = isHighlighted ? 10 : 4;
		context.strokeStyle = isHighlighted ? HIGH_ORANGE_COLOR : TEXT_DARK_COLOR;
		context.beginPath();
		context.roundRect(
			16,
			16,
			canvasElement.width - 32,
			canvasElement.height - 32,
			28,
		);
		context.stroke();

		context.fillStyle = HIGH_ORANGE_COLOR;
		context.beginPath();
		context.roundRect(56, 66, 232, 62, 14);
		context.fill();

		context.fillStyle = RISK_INK_DARK_COLOR;
		context.font =
			'700 34px "Archivo Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
		context.textAlign = "center";
		context.textBaseline = "middle";
		context.fillText("RETRASAR", 172, 98);

		context.fillStyle = BRAND_TEAL_COLOR;
		context.font = '700 24px "JetBrains Mono Variable", monospace';
		context.textAlign = "right";
		context.fillText("DECISIÓN +18 H", canvasElement.width - 56, 97);

		context.fillStyle = TEXT_DARK_COLOR;
		context.font =
			'800 50px "Archivo Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
		context.textAlign = "left";
		context.textBaseline = "alphabetic";
		context.fillText("HUAICO POSIBLE EN HUAROCHIRÍ.", 56, 214);

		context.font =
			'500 34px "JetBrains Mono Variable", -apple-system, BlinkMacSystemFont, monospace';
		context.fillStyle = TEXT_SECONDARY_COLOR;
		context.fillText("Fuente SENAMHI · hora 16:40 · vigencia 14 h", 56, 304);

		const routePrefix = "PE-22 · km 70 a 115 · ";
		context.fillText(routePrefix, 56, 384);
		const prefixWidth = context.measureText(routePrefix).width;

		context.fillStyle = HIGH_ORANGE_COLOR;
		context.beginPath();
		context.roundRect(56 + prefixWidth + 4, 342, 134, 54, 12);
		context.fill();

		context.fillStyle = RISK_INK_DARK_COLOR;
		context.font =
			'700 32px "JetBrains Mono Variable", -apple-system, BlinkMacSystemFont, monospace';
		context.fillText("ALTO", 56 + prefixWidth + 28, 382);

		context.strokeStyle = DIVIDER_LINE_COLOR;
		context.lineWidth = 3;
		context.beginPath();
		context.moveTo(56, 464);
		context.lineTo(canvasElement.width - 56, 464);
		context.stroke();

		context.fillStyle = TEXT_MUTED_COLOR;
		context.font =
			'400 29px "Archivo Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
		context.fillText("Orientación. No reemplaza el aviso oficial.", 56, 542);
	}

	renderCard(false);

	const texture = new THREE.CanvasTexture(canvasElement);
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.colorSpace = THREE.SRGBColorSpace;

	const cardMaterial = new THREE.MeshBasicMaterial({
		map: texture,
		transparent: true,
		side: THREE.DoubleSide,
	});

	const cardGeometry = new THREE.PlaneGeometry(CARD_WIDTH_M, CARD_HEIGHT_M);
	const cardMesh = new THREE.Mesh(cardGeometry, cardMaterial);

	const cardCenterY =
		anchorPosition.y + CARD_FLOAT_Y_OFFSET_M + CARD_HEIGHT_M / 2;
	const cardPivot = new THREE.Group();
	cardPivot.position.set(anchorPosition.x, cardCenterY, anchorPosition.z);
	cardMesh.rotation.x = CARD_TILT_ANGLE_RAD;
	cardPivot.add(cardMesh);
	cardGroup.add(cardPivot);

	const ringGeometry = new THREE.RingGeometry(
		CARD_RING_INNER_RADIUS_M,
		CARD_RING_OUTER_RADIUS_M,
		CARD_RING_SEGMENTS_COUNT,
	);
	ringGeometry.rotateX(-Math.PI / 2);
	const ringMaterial = new THREE.MeshBasicMaterial({
		color: new THREE.Color(HIGH_ORANGE_COLOR),
		side: THREE.DoubleSide,
	});
	const targetRing = new THREE.Mesh(ringGeometry, ringMaterial);
	targetRing.position.set(
		anchorPosition.x,
		anchorPosition.y + CARD_RING_Y_OFFSET_M,
		anchorPosition.z,
	);
	cardGroup.add(targetRing);

	const stemGeometry = new THREE.BufferGeometry().setFromPoints([
		new THREE.Vector3(
			anchorPosition.x,
			anchorPosition.y + CARD_RING_Y_OFFSET_M,
			anchorPosition.z,
		),
		new THREE.Vector3(
			anchorPosition.x,
			cardCenterY - CARD_HEIGHT_M / 2 + CARD_STEM_TOP_OVERLAP_M,
			anchorPosition.z,
		),
	]);
	const stemMaterial = new THREE.LineBasicMaterial({
		color: new THREE.Color(HIGH_ORANGE_COLOR),
	});
	const stemLine = new THREE.Line(stemGeometry, stemMaterial);
	cardGroup.add(stemLine);

	let currentHighlightState = false;

	return {
		group: cardGroup,
		cardMesh,
		targetRing,
		setHighlight: (isHighlighted: boolean) => {
			if (currentHighlightState === isHighlighted) return;
			currentHighlightState = isHighlighted;
			renderCard(isHighlighted);
			texture.needsUpdate = true;
			const scaleTarget = isHighlighted ? CARD_HIGHLIGHT_SCALE_FACTOR : 1.0;
			cardPivot.scale.set(scaleTarget, scaleTarget, scaleTarget);
		},
		faceCamera: (cameraWorldPosition: THREE.Vector3) => {
			const localCameraPosition = cardGroup.worldToLocal(
				cameraWorldPosition.clone(),
			);
			const deltaX = localCameraPosition.x - cardPivot.position.x;
			const deltaZ = localCameraPosition.z - cardPivot.position.z;
			cardPivot.rotation.y = Math.atan2(deltaX, deltaZ);
		},
	};
}

function buildParallelConnectorBridge(
	pointA: THREE.Vector3,
	pointB: THREE.Vector3,
	colorHex: string,
): THREE.Line {
	const bridgePoints: THREE.Vector3[] = [];
	for (
		let stepIndex = 0;
		stepIndex <= PARALLEL_BRIDGE_STEPS_COUNT;
		stepIndex++
	) {
		const interpolationFactor = stepIndex / PARALLEL_BRIDGE_STEPS_COUNT;
		const positionX = THREE.MathUtils.lerp(
			pointA.x,
			pointB.x,
			interpolationFactor,
		);
		const positionZ = THREE.MathUtils.lerp(
			pointA.z,
			pointB.z,
			interpolationFactor,
		);
		const positionY =
			getTerrainHeightAtXZ(positionX, positionZ) + PARALLEL_BRIDGE_Y_OFFSET_M;
		bridgePoints.push(new THREE.Vector3(positionX, positionY, positionZ));
	}
	const geometry = new THREE.BufferGeometry().setFromPoints(bridgePoints);
	const material = new THREE.LineBasicMaterial({
		color: new THREE.Color(colorHex),
	});
	return new THREE.Line(geometry, material);
}

export function buildSceneElements(
	corridors: RouteCorridors,
): SceneElementsResult {
	const rootGroup = new THREE.Group();
	const animatedTextures: AnimatedFlowTextureItem[] = [];

	const terrainGroup = buildTerrain(corridors.pe22Metadata.points);
	rootGroup.add(terrainGroup);

	const { detailsGroup, radarDish } =
		buildInstancedSettlementsAndDetails(corridors);
	rootGroup.add(detailsGroup);

	const { rainGroup, updateRain } = buildMayuRainSystem(
		corridors.hazardSegment,
	);
	rootGroup.add(rainGroup);

	if (corridors.normalSegmentInitial.length > 1) {
		const { mesh: roadInitialMesh } = buildRibbonMesh(
			corridors.normalSegmentInitial,
			NORMAL_ROAD_WIDTH_M,
			NORMAL_ROAD_COLOR,
			NORMAL_ROAD_LIFT_M,
		);
		rootGroup.add(roadInitialMesh);
	}

	const { mesh: hazardMesh, flowTexture: hazardFlowTexture } = buildRibbonMesh(
		corridors.hazardSegment,
		HAZARD_ROAD_WIDTH_M,
		HIGH_ORANGE_COLOR,
		HAZARD_ROAD_LIFT_M,
		"rgba(255, 255, 255, 0.35)",
	);
	if (hazardFlowTexture) {
		animatedTextures.push({
			texture: hazardFlowTexture,
			speedFactor: HAZARD_FLOW_SPEED,
		});
	}
	rootGroup.add(hazardMesh);

	if (corridors.normalSegmentTerminal.length > 1) {
		const { mesh: roadTerminalMesh } = buildRibbonMesh(
			corridors.normalSegmentTerminal,
			NORMAL_ROAD_WIDTH_M,
			NORMAL_ROAD_COLOR,
			NORMAL_ROAD_LIFT_M,
		);
		rootGroup.add(roadTerminalMesh);
	}

	const { mesh: delayedMesh, flowTexture: delayedFlowTexture } =
		buildRibbonMesh(
			corridors.delayedHazardSegment,
			DELAYED_ROAD_WIDTH_M,
			MODERATE_YELLOW_COLOR,
			DELAYED_ROAD_LIFT_M,
			"rgba(10, 37, 48, 0.25)",
		);
	if (delayedFlowTexture) {
		animatedTextures.push({
			texture: delayedFlowTexture,
			speedFactor: DELAYED_FLOW_SPEED,
		});
	}
	rootGroup.add(delayedMesh);

	const hazardFirstPoint = corridors.hazardSegment[0];
	const delayedFirstPoint = corridors.delayedHazardSegment[0];
	if (hazardFirstPoint && delayedFirstPoint) {
		const startBridge = buildParallelConnectorBridge(
			hazardFirstPoint,
			delayedFirstPoint,
			MODERATE_YELLOW_COLOR,
		);
		rootGroup.add(startBridge);
	}

	const hazardLastPoint =
		corridors.hazardSegment[corridors.hazardSegment.length - 1];
	const delayedLastPoint =
		corridors.delayedHazardSegment[corridors.delayedHazardSegment.length - 1];
	if (hazardLastPoint && delayedLastPoint) {
		const endBridge = buildParallelConnectorBridge(
			hazardLastPoint,
			delayedLastPoint,
			MODERATE_YELLOW_COLOR,
		);
		rootGroup.add(endBridge);
	}

	const { mesh: detourMesh, flowTexture: detourFlowTexture } = buildRibbonMesh(
		corridors.detourPoints,
		DETOUR_ROAD_WIDTH_M,
		BRAND_TEAL_COLOR,
		DETOUR_ROAD_LIFT_M,
		"rgba(255, 255, 255, 0.22)",
	);
	if (detourFlowTexture) {
		animatedTextures.push({
			texture: detourFlowTexture,
			speedFactor: DETOUR_FLOW_SPEED,
		});
	}
	rootGroup.add(detourMesh);

	const hazardCenterIndex = Math.floor(corridors.hazardSegment.length * 0.5);
	const hazardCenterPosition =
		corridors.hazardSegment[hazardCenterIndex] ?? new THREE.Vector3(0, 0, 0);

	const floatingCard = createFloatingCard(hazardCenterPosition);
	rootGroup.add(floatingCard.group);

	const hazardLabelAnchor =
		corridors.hazardSegment[Math.floor(corridors.hazardSegment.length * 0.42)];
	if (hazardLabelAnchor) {
		const hazardLabelPos = new THREE.Vector3(
			hazardLabelAnchor.x - 0.09,
			hazardLabelAnchor.y + 0.088,
			hazardLabelAnchor.z - 0.07,
		);
		rootGroup.add(
			createCalloutPin(
				hazardLabelAnchor,
				hazardLabelPos,
				corridors.pe22Metadata.hazardSection.currentLabel,
				HIGH_ORANGE_COLOR,
				RISK_INK_DARK_COLOR,
				TEXT_DARK_COLOR,
				HAZARD_LABEL_FONT_SIZE_PX,
			),
		);
	}

	const delayedLabelAnchor =
		corridors.delayedHazardSegment[
			Math.floor(corridors.delayedHazardSegment.length * 0.68)
		];
	if (delayedLabelAnchor) {
		const delayedLabelPos = new THREE.Vector3(
			delayedLabelAnchor.x + 0.09,
			delayedLabelAnchor.y + 0.06,
			delayedLabelAnchor.z + 0.06,
		);
		rootGroup.add(
			createCalloutPin(
				delayedLabelAnchor,
				delayedLabelPos,
				corridors.pe22Metadata.hazardSection.delayedLabel,
				MODERATE_YELLOW_COLOR,
				RISK_INK_DARK_COLOR,
				TEXT_DARK_COLOR,
				HAZARD_LABEL_FONT_SIZE_PX,
			),
		);
	}

	const detourLabelAnchor =
		corridors.detourPoints[Math.floor(corridors.detourPoints.length * 0.36)];
	if (detourLabelAnchor) {
		const detourLabelPos = new THREE.Vector3(
			detourLabelAnchor.x,
			detourLabelAnchor.y + 0.056,
			detourLabelAnchor.z - 0.035,
		);
		rootGroup.add(
			createCalloutPin(
				detourLabelAnchor,
				detourLabelPos,
				corridors.detourMetadata.name,
				BRAND_TEAL_COLOR,
				SURFACE_WHITE_COLOR,
				SURFACE_WHITE_COLOR,
				DETOUR_LABEL_FONT_SIZE_PX,
			),
		);
	}

	corridors.landmarks.forEach((landmark) => {
		const offset = LANDMARK_OFFSETS[landmark.name] ?? DEFAULT_LANDMARK_OFFSET;
		const labelPos = new THREE.Vector3(
			landmark.position.x + offset.offsetX,
			landmark.position.y + offset.offsetY,
			landmark.position.z + offset.offsetZ,
		);
		const marker = createCalloutPin(
			landmark.position,
			labelPos,
			landmark.name,
			SURFACE_WHITE_COLOR,
			TEXT_DARK_COLOR,
			BRAND_TEAL_COLOR,
			DEFAULT_PIN_FONT_SIZE_PX,
		);
		rootGroup.add(marker);
	});

	return {
		rootGroup,
		hazardMesh,
		floatingCard,
		updateAnimations: (
			deltaSeconds: number,
			elapsedSeconds: number,
			isReducedMotion: boolean,
		) => {
			if (isReducedMotion) {
				floatingCard.targetRing.scale.set(1, 1, 1);
				return;
			}
			for (
				let textureIndex = 0;
				textureIndex < animatedTextures.length;
				textureIndex++
			) {
				const animatedItem = animatedTextures[textureIndex];
				if (!animatedItem) continue;
				animatedItem.texture.offset.x -=
					deltaSeconds * animatedItem.speedFactor;
			}
			const ringScale =
				1 +
				Math.sin(elapsedSeconds * RING_PULSE_FREQUENCY_RAD_S) *
					RING_PULSE_AMPLITUDE;
			floatingCard.targetRing.scale.set(ringScale, ringScale, 1);
			updateRain(elapsedSeconds);
			radarDish.scale.setScalar(
				1 +
					Math.sin(elapsedSeconds * RADAR_PULSE_FREQUENCY_RAD_S) *
						RADAR_PULSE_AMPLITUDE,
			);
		},
	};
}
