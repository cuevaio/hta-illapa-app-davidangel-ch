import {
	BRIDGE_PARAMETERS,
	BYPASS_PARAMETERS,
	type StructureMaterial,
	TUNNEL_PARAMETERS,
	type TunnelSectionShape,
} from "./catalog";
import {
	GRADIENT_SAMPLE_DISTANCE_M,
	MIN_GRADIENT_RATIO,
	PERCENT_SCALE_RATIO,
} from "./constants";

export interface PlacementPoint {
	x: number;
	y: number;
	z: number;
}
export type HeightSampler = (point: { x: number; z: number }) => number | null;
export interface TerrainGradient {
	east: number;
	south: number;
	slopePercent: number;
}
export interface DefaultBridgeTemplate {
	kind: "bridge";
	start: PlacementPoint;
	end: PlacementPoint;
	deckWidthM: number;
	pierCount: number;
	deckMaterial: StructureMaterial;
}
export interface DefaultTunnelTemplate {
	kind: "tunnel";
	start: PlacementPoint;
	end: PlacementPoint;
	sectionWidthM: number;
	sectionHeightM: number;
	shape: TunnelSectionShape;
}
export interface DefaultBypassTemplate {
	kind: "bypass";
	points: PlacementPoint[];
	laneCount: number;
	laneWidthM: number;
}

export function terrainGradient(
	point: PlacementPoint,
	heightAt: HeightSampler,
): TerrainGradient {
	const east =
		((heightAt({ x: point.x + GRADIENT_SAMPLE_DISTANCE_M, z: point.z }) ??
			point.y) -
			(heightAt({ x: point.x - GRADIENT_SAMPLE_DISTANCE_M, z: point.z }) ??
				point.y)) /
		(GRADIENT_SAMPLE_DISTANCE_M * 2);
	const south =
		((heightAt({ x: point.x, z: point.z + GRADIENT_SAMPLE_DISTANCE_M }) ??
			point.y) -
			(heightAt({ x: point.x, z: point.z - GRADIENT_SAMPLE_DISTANCE_M }) ??
				point.y)) /
		(GRADIENT_SAMPLE_DISTANCE_M * 2);
	return {
		east,
		south,
		slopePercent: Math.hypot(east, south) * PERCENT_SCALE_RATIO,
	};
}

export function createDefaultStructureTemplate(
	kind: "bridge" | "tunnel" | "bypass",
	point: PlacementPoint,
	heightAt: HeightSampler,
): DefaultBridgeTemplate | DefaultTunnelTemplate | DefaultBypassTemplate {
	const gradient = terrainGradient(point, heightAt);
	const gradientLength = Math.hypot(gradient.east, gradient.south);
	const uphill =
		gradientLength > MIN_GRADIENT_RATIO
			? {
					x: gradient.east / gradientLength,
					z: gradient.south / gradientLength,
				}
			: { x: 1, z: 0 };
	const direction = kind === "tunnel" ? uphill : { x: -uphill.z, z: uphill.x };
	const spanM =
		kind === "bridge"
			? BRIDGE_PARAMETERS.defaultSpanM
			: kind === "tunnel"
				? TUNNEL_PARAMETERS.defaultLengthM
				: BYPASS_PARAMETERS.defaultLengthM;
	const start = {
		x: (-direction.x * spanM) / 2,
		y: 0,
		z: (-direction.z * spanM) / 2,
	};
	const end = {
		x: (direction.x * spanM) / 2,
		y: 0,
		z: (direction.z * spanM) / 2,
	};
	for (const endpoint of [start, end])
		endpoint.y =
			(heightAt({ x: point.x + endpoint.x, z: point.z + endpoint.z }) ??
				point.y) - point.y;
	if (kind === "bridge")
		return {
			kind,
			start,
			end,
			deckWidthM: BRIDGE_PARAMETERS.deckWidthM.default,
			pierCount: BRIDGE_PARAMETERS.pierCount.default,
			deckMaterial: BRIDGE_PARAMETERS.defaultDeckMaterial,
		};
	if (kind === "tunnel")
		return {
			kind,
			start,
			end,
			sectionWidthM: TUNNEL_PARAMETERS.sectionWidthM.default,
			sectionHeightM: TUNNEL_PARAMETERS.sectionHeightM.default,
			shape: TUNNEL_PARAMETERS.defaultShape,
		};
	return {
		kind,
		points: [start, end],
		laneCount: BYPASS_PARAMETERS.laneCount.default,
		laneWidthM: BYPASS_PARAMETERS.laneWidthM.default,
	};
}
