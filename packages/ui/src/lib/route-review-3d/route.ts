import * as THREE from "three";

import {
	CANYON_WALL_BUMP_HEIGHT_M,
	COASTAL_ASCENT_ELEVATION_GAIN_M,
	COASTAL_ASCENT_EXPONENT,
	COASTAL_BASE_ELEVATION_M,
	CONTINENTAL_DIVIDE_BASE_LON_DEG,
	CONTINENTAL_DIVIDE_LAT_OFFSET_DEG,
	CONTINENTAL_DIVIDE_SLOPE_FACTOR,
	CREST_DECAY_EXPONENT_FACTOR,
	CREST_PEAK_ELEVATION_M,
	CURVE_TENSION_FACTOR,
	DEFAULT_MACRO_ELEVATION_M,
	DELAYED_OFFSET_DISTANCE_M,
	DETOUR_CORRIDOR_WEIGHT,
	EAST_PROGRESS_SPAN_DEG,
	MANTARO_BASIN_HIGH_ELEVATION_M,
	MANTARO_BASIN_LOW_ELEVATION_M,
	MANTARO_BASIN_NORTH_LAT_DEG,
	MANTARO_BASIN_SOUTH_LAT_DEG,
	MAX_ELEVATION_M,
	MAX_LAT_DEG,
	MAX_LON_DEG,
	MAX_TERRAIN_CLAMP_ELEVATION_M,
	MIN_KILOMETER_SPAN_KM,
	MIN_LAT_DEG,
	MIN_LON_DEG,
	MIN_SEGMENT_LENGTH_SQ,
	MIN_WEST_SPAN_DEG,
	OCEAN_COAST_BASE_LON_DEG,
	OCEAN_COAST_LAT_OFFSET_DEG,
	OCEAN_COAST_SLOPE_FACTOR,
	OCEAN_FLOOR_ELEVATION_M,
	OCEAN_TRANSITION_WIDTH_DEG,
	PE22_CORRIDOR_WEIGHT,
	RESAMPLED_DETOUR_STEPS_COUNT,
	RESAMPLED_PE22_HAZARD_STEPS_COUNT,
	RESAMPLED_PE22_INITIAL_STEPS_COUNT,
	RESAMPLED_PE22_TERMINAL_STEPS_COUNT,
	RIDGE_WAVE_A_HEIGHT_M,
	RIDGE_WAVE_A_LAT_FREQ_A,
	RIDGE_WAVE_A_LAT_FREQ_B,
	RIDGE_WAVE_A_LON_FREQ_A,
	RIDGE_WAVE_A_LON_FREQ_B,
	RIDGE_WAVE_B_AMPLITUDE_FACTOR,
	RIDGE_WAVE_B_HEIGHT_M,
	RIDGE_WAVE_B_LAT_FREQ,
	RIDGE_WAVE_B_LON_FREQ,
	ROUGHNESS_MAX_ELEVATION_M,
	ROUGHNESS_MIN_ELEVATION_M,
	SHARED_TRUNK_BLEND_END_LON_DEG,
	SHARED_TRUNK_BLEND_SCALE,
	SHARED_TRUNK_BLEND_START_LON_DEG,
	SHARED_TRUNK_LON_THRESHOLD_DEG,
	SHARED_TRUNK_OFFSET_M,
	SMOOTHSTEP_CUBIC_COEFF_A,
	SMOOTHSTEP_CUBIC_COEFF_B,
	TABLE_BASE_HEIGHT_M,
	TABLE_DEPTH_M,
	TABLE_MAX_HEIGHT_M,
	TABLE_WIDTH_M,
	VALLEY_CARVE_RADIUS_DEG,
} from "./constants";
import detourData from "./data/detour.json";
import pe22Data from "./data/pe22.json";
import type {
	CorridorRawPoint,
	CorridorSegmentProjection,
	GeographicCoordinateLonLat,
	ProjectedPointAtKm,
	RouteCorridors,
	TableCoordinateXZ,
} from "./types";

const allCorridorSegments: CorridorSegmentProjection[] = [];

function buildCorridorSegments(
	corridorPoints: CorridorRawPoint[],
	corridorWeight = PE22_CORRIDOR_WEIGHT,
): void {
	for (
		let pointIndex = 0;
		pointIndex < corridorPoints.length - 1;
		pointIndex++
	) {
		const startPoint = corridorPoints[pointIndex];
		const endPoint = corridorPoints[pointIndex + 1];
		if (!startPoint || !endPoint) continue;

		const deltaLon = endPoint.lon - startPoint.lon;
		const deltaLat = endPoint.lat - startPoint.lat;
		const lengthSq = deltaLon * deltaLon + deltaLat * deltaLat;
		if (lengthSq > MIN_SEGMENT_LENGTH_SQ) {
			allCorridorSegments.push({
				lonA: startPoint.lon,
				latA: startPoint.lat,
				elevA: startPoint.elevationM,
				lonB: endPoint.lon,
				latB: endPoint.lat,
				elevB: endPoint.elevationM,
				deltaLon,
				deltaLat,
				lengthSq,
				weight: corridorWeight,
			});
		}
	}
}

buildCorridorSegments(pe22Data.points, PE22_CORRIDOR_WEIGHT);
buildCorridorSegments(detourData.points, DETOUR_CORRIDOR_WEIGHT);

export function sampleTerrainElevationMeters(
	longitudeDegrees: number,
	latitudeDegrees: number,
): number {
	const divideLon =
		CONTINENTAL_DIVIDE_BASE_LON_DEG -
		(latitudeDegrees + CONTINENTAL_DIVIDE_LAT_OFFSET_DEG) *
			CONTINENTAL_DIVIDE_SLOPE_FACTOR;
	const distFromDivide = longitudeDegrees - divideLon;

	let macroElevationM = DEFAULT_MACRO_ELEVATION_M;
	if (distFromDivide < 0) {
		const westSpan = Math.max(MIN_WEST_SPAN_DEG, divideLon - MIN_LON_DEG);
		const ascentRatio = THREE.MathUtils.clamp(
			1 + distFromDivide / westSpan,
			0,
			1,
		);
		const coastalFlat = ascentRatio ** COASTAL_ASCENT_EXPONENT;
		macroElevationM =
			COASTAL_BASE_ELEVATION_M + coastalFlat * COASTAL_ASCENT_ELEVATION_GAIN_M;
	} else {
		const eastProgress = THREE.MathUtils.clamp(
			distFromDivide / EAST_PROGRESS_SPAN_DEG,
			0,
			1,
		);
		const mantaroBasinFactor = THREE.MathUtils.smoothstep(
			latitudeDegrees,
			MANTARO_BASIN_SOUTH_LAT_DEG,
			MANTARO_BASIN_NORTH_LAT_DEG,
		);
		const targetEastElev = THREE.MathUtils.lerp(
			MANTARO_BASIN_LOW_ELEVATION_M,
			MANTARO_BASIN_HIGH_ELEVATION_M,
			mantaroBasinFactor,
		);
		const crestDecay = Math.exp(-eastProgress * CREST_DECAY_EXPONENT_FACTOR);
		macroElevationM =
			targetEastElev + (CREST_PEAK_ELEVATION_M - targetEastElev) * crestDecay;
	}

	const ridgeWaveA =
		Math.sin(
			longitudeDegrees * RIDGE_WAVE_A_LON_FREQ_A +
				latitudeDegrees * RIDGE_WAVE_A_LAT_FREQ_A,
		) *
		Math.cos(
			longitudeDegrees * RIDGE_WAVE_A_LON_FREQ_B -
				latitudeDegrees * RIDGE_WAVE_A_LAT_FREQ_B,
		);
	const ridgeWaveB =
		Math.sin(
			longitudeDegrees * RIDGE_WAVE_B_LON_FREQ -
				latitudeDegrees * RIDGE_WAVE_B_LAT_FREQ,
		) * RIDGE_WAVE_B_AMPLITUDE_FACTOR;
	const mountainRoughnessFactor = THREE.MathUtils.smoothstep(
		macroElevationM,
		ROUGHNESS_MIN_ELEVATION_M,
		ROUGHNESS_MAX_ELEVATION_M,
	);
	macroElevationM +=
		(ridgeWaveA * RIDGE_WAVE_A_HEIGHT_M + ridgeWaveB * RIDGE_WAVE_B_HEIGHT_M) *
		mountainRoughnessFactor;

	const oceanCoastLineLon =
		OCEAN_COAST_BASE_LON_DEG -
		(latitudeDegrees + OCEAN_COAST_LAT_OFFSET_DEG) * OCEAN_COAST_SLOPE_FACTOR;
	if (longitudeDegrees < oceanCoastLineLon) {
		const oceanFactor = THREE.MathUtils.clamp(
			(oceanCoastLineLon - longitudeDegrees) / OCEAN_TRANSITION_WIDTH_DEG,
			0,
			1,
		);
		macroElevationM = THREE.MathUtils.lerp(
			macroElevationM,
			OCEAN_FLOOR_ELEVATION_M,
			oceanFactor,
		);
	}

	let closestDistanceSq = Number.POSITIVE_INFINITY;
	let interpolatedRoadElevationM = macroElevationM;

	for (
		let segmentIndex = 0;
		segmentIndex < allCorridorSegments.length;
		segmentIndex++
	) {
		const segment = allCorridorSegments[segmentIndex];
		if (!segment) continue;

		const projectionFactor = THREE.MathUtils.clamp(
			((longitudeDegrees - segment.lonA) * segment.deltaLon +
				(latitudeDegrees - segment.latA) * segment.deltaLat) /
				segment.lengthSq,
			0,
			1,
		);
		const nearestLon = segment.lonA + projectionFactor * segment.deltaLon;
		const nearestLat = segment.latA + projectionFactor * segment.deltaLat;
		const diffLon = longitudeDegrees - nearestLon;
		const diffLat = latitudeDegrees - nearestLat;
		const distanceSq = diffLon * diffLon + diffLat * diffLat;

		if (distanceSq < closestDistanceSq) {
			closestDistanceSq = distanceSq;
			interpolatedRoadElevationM =
				segment.elevA + projectionFactor * (segment.elevB - segment.elevA);
		}
	}

	const distanceDegrees = Math.sqrt(closestDistanceSq);

	if (distanceDegrees < VALLEY_CARVE_RADIUS_DEG) {
		const normalizedDistance = distanceDegrees / VALLEY_CARVE_RADIUS_DEG;
		const valleyCarveBlend =
			1 -
			normalizedDistance *
				normalizedDistance *
				(SMOOTHSTEP_CUBIC_COEFF_A -
					SMOOTHSTEP_CUBIC_COEFF_B * normalizedDistance);
		const canyonWallBump =
			Math.sin(normalizedDistance * Math.PI) *
			CANYON_WALL_BUMP_HEIGHT_M *
			mountainRoughnessFactor;
		const carvedTerrainElevation = THREE.MathUtils.lerp(
			macroElevationM + canyonWallBump,
			interpolatedRoadElevationM,
			valleyCarveBlend,
		);
		macroElevationM = carvedTerrainElevation;
	}

	return THREE.MathUtils.clamp(
		macroElevationM,
		0,
		MAX_TERRAIN_CLAMP_ELEVATION_M,
	);
}

export function lonLatToTableXZ(
	longitudeDegrees: number,
	latitudeDegrees: number,
): TableCoordinateXZ {
	const normalizedX =
		(longitudeDegrees - MIN_LON_DEG) / (MAX_LON_DEG - MIN_LON_DEG);
	const normalizedZ =
		(latitudeDegrees - MIN_LAT_DEG) / (MAX_LAT_DEG - MIN_LAT_DEG);

	return {
		positionX: (normalizedX - 0.5) * TABLE_WIDTH_M,
		positionZ: (0.5 - normalizedZ) * TABLE_DEPTH_M,
	};
}

export function tableXZToLonLat(
	positionX: number,
	positionZ: number,
): GeographicCoordinateLonLat {
	const longitudeDegrees =
		MIN_LON_DEG +
		(positionX / TABLE_WIDTH_M + 0.5) * (MAX_LON_DEG - MIN_LON_DEG);
	const latitudeDegrees =
		MIN_LAT_DEG +
		(0.5 - positionZ / TABLE_DEPTH_M) * (MAX_LAT_DEG - MIN_LAT_DEG);
	return { longitudeDegrees, latitudeDegrees };
}

export function getTerrainHeightAtXZ(
	positionX: number,
	positionZ: number,
): number {
	const { longitudeDegrees, latitudeDegrees } = tableXZToLonLat(
		positionX,
		positionZ,
	);
	const elevationMeters = sampleTerrainElevationMeters(
		longitudeDegrees,
		latitudeDegrees,
	);
	return (
		TABLE_BASE_HEIGHT_M +
		(elevationMeters / MAX_ELEVATION_M) * TABLE_MAX_HEIGHT_M
	);
}

export function projectCoordinate(
	longitudeDegrees: number,
	latitudeDegrees: number,
): THREE.Vector3 {
	const { positionX, positionZ } = lonLatToTableXZ(
		longitudeDegrees,
		latitudeDegrees,
	);
	const positionY = getTerrainHeightAtXZ(positionX, positionZ);
	return new THREE.Vector3(positionX, positionY, positionZ);
}

function resampleCurveOnTerrain(
	rawVectors: THREE.Vector3[],
	stepsCount: number,
): THREE.Vector3[] {
	if (rawVectors.length < 2) return rawVectors;
	const flatCurve = new THREE.CatmullRomCurve3(
		rawVectors,
		false,
		"centripetal",
		CURVE_TENSION_FACTOR,
	);
	const sampledPoints = flatCurve.getSpacedPoints(stepsCount);
	for (let pointIndex = 0; pointIndex < sampledPoints.length; pointIndex++) {
		const sampledPoint = sampledPoints[pointIndex];
		if (!sampledPoint) continue;
		sampledPoint.y = getTerrainHeightAtXZ(sampledPoint.x, sampledPoint.z);
	}
	return sampledPoints;
}

export function getPointAtPe22Km(targetKm: number): ProjectedPointAtKm {
	const corridorPoints = pe22Data.points;
	for (
		let pointIndex = 0;
		pointIndex < corridorPoints.length - 1;
		pointIndex++
	) {
		const startPoint = corridorPoints[pointIndex];
		const endPoint = corridorPoints[pointIndex + 1];
		if (!startPoint || !endPoint) continue;

		if (targetKm >= startPoint.km && targetKm <= endPoint.km) {
			const kilometerSpan = Math.max(
				MIN_KILOMETER_SPAN_KM,
				endPoint.km - startPoint.km,
			);
			const interpolationFactor = (targetKm - startPoint.km) / kilometerSpan;
			const longitudeDegrees = THREE.MathUtils.lerp(
				startPoint.lon,
				endPoint.lon,
				interpolationFactor,
			);
			const latitudeDegrees = THREE.MathUtils.lerp(
				startPoint.lat,
				endPoint.lat,
				interpolationFactor,
			);
			const projectedPosition = projectCoordinate(
				longitudeDegrees,
				latitudeDegrees,
			);
			const nextPosition = projectCoordinate(endPoint.lon, endPoint.lat);
			const previousPosition = projectCoordinate(
				startPoint.lon,
				startPoint.lat,
			);
			const tangentVector = new THREE.Vector3()
				.subVectors(nextPosition, previousPosition)
				.setY(0)
				.normalize();
			const normalVector = new THREE.Vector3(
				-tangentVector.z,
				0,
				tangentVector.x,
			);
			return {
				position: projectedPosition,
				tangent: tangentVector,
				normal: normalVector,
				longitudeDegrees,
				latitudeDegrees,
			};
		}
	}
	const fallbackPoint = corridorPoints[corridorPoints.length - 1] ?? {
		lon: MIN_LON_DEG,
		lat: MIN_LAT_DEG,
		km: 0,
		elevationM: 0,
	};
	return {
		position: projectCoordinate(fallbackPoint.lon, fallbackPoint.lat),
		tangent: new THREE.Vector3(1, 0, 0),
		normal: new THREE.Vector3(0, 0, 1),
		longitudeDegrees: fallbackPoint.lon,
		latitudeDegrees: fallbackPoint.lat,
	};
}

export function loadRouteCorridors(): RouteCorridors {
	const pe22Projected = pe22Data.points.map((point) => ({
		position: projectCoordinate(point.lon, point.lat),
		km: point.km,
		elevationM: point.elevationM,
	}));

	const hazardStartIndex = pe22Projected.findIndex(
		(point) => point.km >= pe22Data.hazardSection.fromKm,
	);
	const hazardEndIndex = pe22Projected.findIndex(
		(point) => point.km >= pe22Data.hazardSection.toKm,
	);

	const effectiveStartIndex = hazardStartIndex !== -1 ? hazardStartIndex : 0;
	const effectiveEndIndex =
		hazardEndIndex !== -1 ? hazardEndIndex : pe22Projected.length - 1;

	const rawInitial = pe22Projected
		.slice(0, effectiveStartIndex + 1)
		.map((item) => item.position);
	const rawHazard = pe22Projected
		.slice(effectiveStartIndex, effectiveEndIndex + 1)
		.map((item) => item.position);
	const rawTerminal = pe22Projected
		.slice(effectiveEndIndex)
		.map((item) => item.position);

	const normalSegmentInitial = resampleCurveOnTerrain(
		rawInitial,
		RESAMPLED_PE22_INITIAL_STEPS_COUNT,
	);
	const hazardSegment = resampleCurveOnTerrain(
		rawHazard,
		RESAMPLED_PE22_HAZARD_STEPS_COUNT,
	);
	const normalSegmentTerminal = resampleCurveOnTerrain(
		rawTerminal,
		RESAMPLED_PE22_TERMINAL_STEPS_COUNT,
	);

	const delayedHazardSegment: THREE.Vector3[] = [];
	for (
		let segmentIndex = 0;
		segmentIndex < hazardSegment.length;
		segmentIndex++
	) {
		const currentPosition = hazardSegment[segmentIndex];
		if (!currentPosition) continue;

		const previousPosition =
			(segmentIndex > 0 ? hazardSegment[segmentIndex - 1] : currentPosition) ??
			currentPosition;
		const nextPosition =
			(segmentIndex < hazardSegment.length - 1
				? hazardSegment[segmentIndex + 1]
				: currentPosition) ?? currentPosition;

		const tangentDirection = new THREE.Vector3().subVectors(
			nextPosition,
			previousPosition,
		);
		tangentDirection.y = 0;
		tangentDirection.normalize();

		const lateralNormal = new THREE.Vector3(
			-tangentDirection.z,
			0,
			tangentDirection.x,
		);
		const offsetX =
			currentPosition.x + lateralNormal.x * DELAYED_OFFSET_DISTANCE_M;
		const offsetZ =
			currentPosition.z + lateralNormal.z * DELAYED_OFFSET_DISTANCE_M;
		const offsetY = getTerrainHeightAtXZ(offsetX, offsetZ);

		delayedHazardSegment.push(new THREE.Vector3(offsetX, offsetY, offsetZ));
	}

	const rawDetourVectors = detourData.points.map((point) => {
		const baseVector = projectCoordinate(point.lon, point.lat);
		if (point.lon > SHARED_TRUNK_LON_THRESHOLD_DEG) {
			const trunkBlend = THREE.MathUtils.smoothstep(
				point.lon,
				SHARED_TRUNK_BLEND_START_LON_DEG,
				SHARED_TRUNK_BLEND_END_LON_DEG,
			);
			baseVector.x +=
				SHARED_TRUNK_OFFSET_M * trunkBlend * SHARED_TRUNK_BLEND_SCALE;
			baseVector.z -=
				SHARED_TRUNK_OFFSET_M * trunkBlend * SHARED_TRUNK_BLEND_SCALE;
			baseVector.y = getTerrainHeightAtXZ(baseVector.x, baseVector.z);
		}
		return baseVector;
	});

	const detourPoints = resampleCurveOnTerrain(
		rawDetourVectors,
		RESAMPLED_DETOUR_STEPS_COUNT,
	);

	const landmarkMarkers = pe22Data.landmarks.map((landmark) => ({
		name: landmark.name,
		km: landmark.km,
		elevationM: landmark.elevationM,
		position: projectCoordinate(landmark.lon, landmark.lat),
	}));

	return {
		pe22Metadata: pe22Data,
		detourMetadata: detourData,
		normalSegmentInitial,
		hazardSegment,
		normalSegmentTerminal,
		delayedHazardSegment,
		detourPoints,
		landmarks: landmarkMarkers,
	};
}
