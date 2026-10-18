import type { Database } from "@hack-the-andes-project/db";
import {
	type RiskHorizonHours,
	roadEdge,
	roadNode,
	roadSegment,
	segmentRiskAssessment,
} from "@hack-the-andes-project/db/schema/risk";
import { incident, poi } from "@hack-the-andes-project/db/schema/scraper";
import { nearestPointOnLine } from "@turf/nearest-point-on-line";
import { and, eq, gt, gte, inArray, lte } from "drizzle-orm";
import type { MySqlColumn } from "drizzle-orm/mysql-core";
import type { Geometry, LineString, Position } from "geojson";

import type { LatLng } from "../hazards/types";
import {
	CLOSURE_CANDIDATE_RADIUS_DEG,
	CLOSURE_MATCH_RADIUS_M,
	GEOMETRY_FETCH_BATCH_ROWS,
	ROUTING_BOUNDS_MARGIN_DEG,
	ROUTING_BOUNDS_SPAN_RATIO,
} from "./constants";
import { findRiskAwareRoutes, type RouteEvaluation } from "./route";

export interface CompareRiskAwareRoutesInput {
	db: Database;
	origin: LatLng;
	destination: LatLng;
	horizonHours: RiskHorizonHours;
	now: Date;
}

export interface ClosureCandidateEdge extends LatLng {
	id: string;
	roadCode: string | null;
	geometry: LineString;
}

export interface EvaluatedRoute extends Omit<RouteEvaluation, "edgeIds"> {
	geometry: LineString;
}

export interface RouteClosure extends LatLng {
	id: string;
	title: string;
	roadCode: string | null;
}

export interface OfficialDetour {
	id: string;
	name: string;
	geometry: Geometry | null;
	roadCodes: string[] | null;
}

export interface RiskAwareRouteComparison {
	fastest: EvaluatedRoute | null;
	safest: EvaluatedRoute | null;
	closures: RouteClosure[];
	// Only filled when the graph finds no viable route.
	officialDetours: OfficialDetour[];
	assessedFrom: Date | null;
	assessedUntil: Date | null;
}

export interface Bounds {
	west: number;
	south: number;
	east: number;
	north: number;
}

export function withinBounds(
	columns: { lat: MySqlColumn; lng: MySqlColumn },
	bounds: Bounds,
) {
	return and(
		gte(columns.lat, bounds.south),
		lte(columns.lat, bounds.north),
		gte(columns.lng, bounds.west),
		lte(columns.lng, bounds.east),
	);
}

export async function fetchEdgeGeometries(
	db: Database,
	edgeIds: string[],
): Promise<Map<string, LineString>> {
	const geometries = new Map<string, LineString>();
	for (
		let offset = 0;
		offset < edgeIds.length;
		offset += GEOMETRY_FETCH_BATCH_ROWS
	) {
		const rows = await db
			.select({ id: roadEdge.id, geometry: roadEdge.geometry })
			.from(roadEdge)
			.where(
				inArray(
					roadEdge.id,
					edgeIds.slice(offset, offset + GEOMETRY_FETCH_BATCH_ROWS),
				),
			);
		for (const row of rows) geometries.set(row.id, row.geometry);
	}
	return geometries;
}

async function withGeometry(
	db: Database,
	route: RouteEvaluation | null,
): Promise<EvaluatedRoute | null> {
	if (!route) return null;
	const geometries = await fetchEdgeGeometries(db, route.edgeIds);
	const coordinates: Position[] = [];
	for (const edgeId of route.edgeIds) {
		const edgeCoordinates = geometries.get(edgeId)?.coordinates ?? [];
		// Consecutive edges share their junction vertex.
		coordinates.push(...edgeCoordinates.slice(coordinates.length > 0 ? 1 : 0));
	}
	const { edgeIds: _edgeIds, ...evaluation } = route;
	return { ...evaluation, geometry: { type: "LineString", coordinates } };
}

// Mountain roads detour far from the straight line between endpoints (Lima and
// Huancayo share a latitude while the Carretera Central climbs ~0.5° north to
// Ticlio), so the margin grows with the trip instead of staying fixed.
export function routingBounds(origin: LatLng, destination: LatLng): Bounds {
	const margin = Math.max(
		ROUTING_BOUNDS_MARGIN_DEG,
		ROUTING_BOUNDS_SPAN_RATIO *
			Math.max(
				Math.abs(origin.lat - destination.lat),
				Math.abs(origin.lng - destination.lng),
			),
	);
	return {
		west: Math.min(origin.lng, destination.lng) - margin,
		east: Math.max(origin.lng, destination.lng) + margin,
		south: Math.min(origin.lat, destination.lat) - margin,
		north: Math.max(origin.lat, destination.lat) + margin,
	};
}

// Edges are short and located by their midpoint, so one this far from a
// closure cannot reach it and its geometry is never measured.
function isNearClosure(edge: LatLng, closure: LatLng) {
	return (
		Math.abs(edge.lat - closure.lat) <= CLOSURE_CANDIDATE_RADIUS_DEG &&
		Math.abs(edge.lng - closure.lng) <= CLOSURE_CANDIDATE_RADIUS_DEG
	);
}

// A closure on a coded road (SUTRAN reports PE-xx) must not close a nearby
// street or bridge with another code. Edges without a code stay blockable:
// OSM sometimes lacks the ref on the very road that is closed, and routing
// through an official closure is the worse mistake.
export function closedEdgeIds(
	edges: ClosureCandidateEdge[],
	closures: RouteClosure[],
): Set<string> {
	return new Set(
		edges
			.filter((edge) =>
				closures.some(
					(closure) =>
						isNearClosure(edge, closure) &&
						(closure.roadCode === null ||
							edge.roadCode === null ||
							closure.roadCode === edge.roadCode) &&
						nearestPointOnLine(edge.geometry, [closure.lng, closure.lat], {
							units: "meters",
						}).properties.pointDistance <= CLOSURE_MATCH_RADIUS_M,
				),
			)
			.map((edge) => edge.id),
	);
}

// Geometry stays out of the bulk load: only the chosen routes' edges and
// closure candidates need it.
export async function loadRoadGraph(db: Database, bounds: Bounds) {
	const [edges, nodes] = await Promise.all([
		db
			.select({
				id: roadEdge.id,
				fromNodeId: roadEdge.fromNodeId,
				toNodeId: roadEdge.toNodeId,
				lengthM: roadEdge.lengthM,
				travelTimeS: roadEdge.travelTimeS,
				segmentId: roadEdge.segmentId,
				roadCode: roadEdge.roadCode,
				roadName: roadEdge.roadName,
				lat: roadEdge.lat,
				lng: roadEdge.lng,
			})
			.from(roadEdge)
			.where(withinBounds(roadEdge, bounds)),
		db
			.select({ id: roadNode.id, lat: roadNode.lat, lng: roadNode.lng })
			.from(roadNode)
			.where(withinBounds(roadNode, bounds)),
	]);
	return { edges, nodes };
}

export async function blockClosedEdges(
	db: Database,
	edges: (LatLng & { id: string; roadCode: string | null })[],
	closures: RouteClosure[],
): Promise<Set<string>> {
	const candidateEdges = edges.filter((edge) =>
		closures.some((closure) => isNearClosure(edge, closure)),
	);
	const candidateGeometries = await fetchEdgeGeometries(
		db,
		candidateEdges.map((edge) => edge.id),
	);
	return closedEdgeIds(
		candidateEdges.flatMap((edge) => {
			const geometry = candidateGeometries.get(edge.id);
			return geometry ? [{ ...edge, geometry }] : [];
		}),
		closures,
	);
}

export async function compareRiskAwareRoutes({
	db,
	origin,
	destination,
	horizonHours,
	now,
}: CompareRiskAwareRoutesInput): Promise<RiskAwareRouteComparison> {
	const bounds = routingBounds(origin, destination);

	const [{ edges, nodes }, risks, closureIncidents] = await Promise.all([
		loadRoadGraph(db, bounds),
		db
			.select({
				segmentId: segmentRiskAssessment.segmentId,
				score: segmentRiskAssessment.score,
				assessedAt: segmentRiskAssessment.assessedAt,
			})
			.from(segmentRiskAssessment)
			.innerJoin(
				roadSegment,
				eq(roadSegment.id, segmentRiskAssessment.segmentId),
			)
			.where(
				and(
					eq(segmentRiskAssessment.horizonHours, horizonHours),
					// Expired assessments would route on yesterday's rain; they
					// count as unassessed instead.
					gt(segmentRiskAssessment.validUntil, now),
					withinBounds(roadSegment, bounds),
				),
			),
		db
			.select({
				id: incident.id,
				title: incident.title,
				roadCode: incident.roadCode,
				lat: incident.lat,
				lng: incident.lng,
			})
			.from(incident)
			.where(
				and(
					eq(incident.active, true),
					eq(incident.roadStatus, "interrumpido"),
					withinBounds(incident, bounds),
				),
			),
	]);

	const closures = closureIncidents.flatMap((closure) =>
		closure.lat === null || closure.lng === null
			? []
			: [{ ...closure, lat: closure.lat, lng: closure.lng }],
	);
	const blockedEdgeIds = await blockClosedEdges(db, edges, closures);

	const routes = findRiskAwareRoutes({
		nodes,
		edges,
		riskBySegment: new Map(risks.map((risk) => [risk.segmentId, risk.score])),
		blockedEdgeIds,
		origin,
		destination,
	});

	const officialDetours = routes.fastest
		? []
		: await db
				.select({
					id: poi.id,
					name: poi.name,
					geometry: poi.geometry,
					roadCodes: poi.roadCodes,
				})
				.from(poi)
				.where(
					and(
						eq(poi.active, true),
						eq(poi.kind, "alt_route"),
						withinBounds(poi, bounds),
					),
				);

	const assessedAtTimes = risks.map((risk) => risk.assessedAt.getTime());
	return {
		fastest: await withGeometry(db, routes.fastest),
		safest: await withGeometry(db, routes.safest),
		closures,
		officialDetours,
		assessedFrom:
			assessedAtTimes.length > 0
				? new Date(Math.min(...assessedAtTimes))
				: null,
		assessedUntil:
			assessedAtTimes.length > 0
				? new Date(Math.max(...assessedAtTimes))
				: null,
	};
}
