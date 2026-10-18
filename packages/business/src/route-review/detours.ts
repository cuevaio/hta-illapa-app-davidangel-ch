import { distance } from "@turf/distance";
import { nearestPointOnLine } from "@turf/nearest-point-on-line";
import type { Geometry, LineString, Position } from "geojson";

import {
	DETOUR_MAX_ANCHORS,
	DETOUR_PIECE_LENGTH_M,
	DETOUR_SEGMENT_MATCH_RADIUS_M,
	DETOUR_TRAMO_MATCH_RADIUS_M,
	DETOUR_TRAMO_SAMPLE_POINTS,
	DOUBLE_AXLE_TRUCK_AXLE_COUNT,
} from "../constants";
import type { LatLng } from "../hazards/types";
import type { ReviewEdge } from "./assemble";

const MAX_AXLE_COUNT_PATTERN = /hasta\s+(\d+)\s+ejes/i;
const DOUBLE_AXLE_TRUCK_PATTERN = /doble\s+eje/i;

export interface AltRoutePoi {
	id: string;
	name: string;
	geometry: Geometry | null;
	roadCodes: string[] | null;
	attributes: Record<string, unknown>;
}

export interface SutranDetour {
	id: string;
	name: string;
	roadCodes: string[];
	restriction: string | null;
	maxAxleCount: number | null;
	geometries: LineString[];
}

export interface SutranDetourRegion {
	region: string;
	// SUTRAN's own definition of the stretch its detours replace, not an
	// active closure.
	tramos: LineString[];
	detours: SutranDetour[];
}

export interface SegmentPoint extends LatLng {
	id: string;
}

interface DetourRegionEntry {
	tramos: LineString[];
	detours: Map<string, SutranDetour & { km: number }>;
}

export function parseMaxAxleCount(restriction: string | null): number | null {
	const match = restriction?.match(MAX_AXLE_COUNT_PATTERN);
	if (match?.[1]) return Number(match[1]);
	return restriction && DOUBLE_AXLE_TRUCK_PATTERN.test(restriction)
		? DOUBLE_AXLE_TRUCK_AXLE_COUNT
		: null;
}

function lineStrings(geometry: Geometry | null): LineString[] {
	if (geometry?.type === "LineString") return [geometry];
	if (geometry?.type === "MultiLineString") {
		return geometry.coordinates.map((coordinates) => ({
			type: "LineString",
			coordinates,
		}));
	}
	return [];
}

function stringAttribute(attributes: Record<string, unknown>, key: string) {
	const value = attributes[key];
	return typeof value === "string" ? value : null;
}

export function groupSutranDetours(pois: AltRoutePoi[]): SutranDetourRegion[] {
	const regions = new Map<string, DetourRegionEntry>();
	for (const poi of pois) {
		const region = stringAttribute(poi.attributes, "region");
		const geometries = lineStrings(poi.geometry);
		if (!region || geometries.length === 0) continue;
		const entry: DetourRegionEntry = regions.get(region) ?? {
			tramos: [],
			detours: new Map(),
		};
		regions.set(region, entry);
		if (stringAttribute(poi.attributes, "tipo") === "interrumpido") {
			entry.tramos.push(...geometries);
			continue;
		}
		const route = stringAttribute(poi.attributes, "ruta") ?? poi.name;
		const existing = entry.detours.get(route);
		if (existing) {
			existing.geometries.push(...geometries);
			continue;
		}
		const restriction = stringAttribute(poi.attributes, "restriccion");
		const km = poi.attributes.distanciaKm;
		entry.detours.set(route, {
			id: `sutran:${region}:${poi.id}`,
			name: route,
			roadCodes: poi.roadCodes ?? [],
			restriction,
			maxAxleCount: parseMaxAxleCount(restriction),
			geometries,
			km: typeof km === "number" ? km : Number.POSITIVE_INFINITY,
		});
	}
	return [...regions].flatMap(([region, { tramos, detours }]) =>
		tramos.length > 0 && detours.size > 0
			? [
					{
						region,
						tramos,
						detours: [...detours.values()]
							.toSorted((first, second) => first.km - second.km)
							.map(({ km: _km, ...detour }) => detour),
					},
				]
			: [],
	);
}

export function routeFollowsTramo(route: LineString, tramo: LineString) {
	const step = Math.max(
		1,
		Math.floor(tramo.coordinates.length / DETOUR_TRAMO_SAMPLE_POINTS),
	);
	const samples = tramo.coordinates.filter((_, index) => index % step === 0);
	const onRoute = samples.filter(
		(position) =>
			nearestPointOnLine(route, position, { units: "meters" }).properties
				.pointDistance <= DETOUR_TRAMO_MATCH_RADIUS_M,
	);
	return onRoute.length * 2 >= samples.length;
}

function distanceM(from: Position, to: Position): number {
	return distance(from, to, { units: "meters" });
}

// SUTRAN publishes each detour as unordered fragments. Their midpoints are
// chained from the origin by nearest neighbour and thinned to a few anchors.
// Endpoints are left out: a long fragment's far end can sit next to the
// destination, and a spur's end would send the route out and back.
export function detourAnchors(
	origin: LatLng,
	geometries: LineString[],
): LatLng[] {
	const remaining = geometries.flatMap(({ coordinates }) => {
		const middle = coordinates[Math.floor(coordinates.length / 2)];
		return middle ? [middle] : [];
	});
	const chain: Position[] = [];
	let current: Position = [origin.lng, origin.lat];
	while (remaining.length > 0) {
		let nearestIndex = 0;
		remaining.forEach((position, index) => {
			const nearest = remaining[nearestIndex];
			if (
				nearest &&
				distanceM(current, position) < distanceM(current, nearest)
			) {
				nearestIndex = index;
			}
		});
		const [next] = remaining.splice(nearestIndex, 1);
		if (!next) break;
		chain.push(next);
		current = next;
	}
	const anchorCount = Math.min(DETOUR_MAX_ANCHORS, chain.length);
	return Array.from({ length: anchorCount }, (_, index) => {
		const position =
			chain[
				anchorCount === 1
					? 0
					: Math.round((index * (chain.length - 1)) / (anchorCount - 1))
			];
		return {
			lat: position?.[1] ?? origin.lat,
			lng: position?.[0] ?? origin.lng,
		};
	});
}

// A detour has no graph edges, so its OSRM line is cut into pieces of about
// 1 km that take the risk segment nearest to their middle, and then go
// through the same segment, risk and signal rules as a routed path.
export function splitIntoPseudoEdges(
	detourId: string,
	line: LineString,
	durationS: number,
	segments: SegmentPoint[],
): ReviewEdge[] {
	const pieces: Position[][] = [];
	let current: Position[] = [];
	let currentLengthM = 0;
	line.coordinates.forEach((position, index) => {
		const previous = line.coordinates[index - 1];
		if (previous) currentLengthM += distanceM(previous, position);
		current.push(position);
		if (currentLengthM >= DETOUR_PIECE_LENGTH_M) {
			pieces.push(current);
			current = [position];
			currentLengthM = 0;
		}
	});
	if (current.length > 1) pieces.push(current);

	const lengths = pieces.map((coordinates) =>
		coordinates
			.slice(1)
			.reduce(
				(total, position, index) =>
					total + distanceM(coordinates[index] ?? position, position),
				0,
			),
	);
	const totalLengthM = lengths.reduce((total, lengthM) => total + lengthM, 0);

	return pieces.map((coordinates, index) => {
		const middle = coordinates[Math.floor(coordinates.length / 2)] ?? [0, 0];
		let segmentId: string | null = null;
		let nearestM = DETOUR_SEGMENT_MATCH_RADIUS_M;
		for (const segment of segments) {
			const segmentDistanceM = distanceM(middle, [segment.lng, segment.lat]);
			if (segmentDistanceM <= nearestM) {
				nearestM = segmentDistanceM;
				segmentId = segment.id;
			}
		}
		const lengthM = lengths[index] ?? 0;
		return {
			id: `${detourId}:${index}`,
			segmentId,
			roadCode: null,
			roadName: null,
			lengthM,
			travelTimeS: totalLengthM > 0 ? (durationS * lengthM) / totalLengthM : 0,
			lat: middle[1] ?? 0,
			lng: middle[0] ?? 0,
			geometry: { type: "LineString", coordinates },
		};
	});
}
