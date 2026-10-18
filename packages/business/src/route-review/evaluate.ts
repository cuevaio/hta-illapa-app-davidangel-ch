import type { Database } from "@hack-the-andes-project/db";
import {
	roadSegment,
	segmentRiskAssessment,
} from "@hack-the-andes-project/db/schema/risk";
import { incident, poi } from "@hack-the-andes-project/db/schema/scraper";
import { bbox } from "@turf/bbox";
import { simplify } from "@turf/simplify";
import { and, eq, gt, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { RequestLogger } from "evlog";
import type { LineString } from "geojson";

import {
	DETOUR_TRAMO_ROUTE_SIMPLIFY_TOLERANCE_DEG,
	ROUTE_REVIEW_ROUTING_HORIZON_HOURS,
} from "../constants";
import type { LatLng } from "../hazards/types";
import {
	type Bounds,
	blockClosedEdges,
	fetchEdgeGeometries,
	loadRoadGraph,
	routingBounds,
	withinBounds,
} from "../risk/compare-routes";
import { OFFICIAL_ALERT_CATEGORIES } from "../risk/constants";
import {
	findFastestRoute,
	findRiskAwareRoutes,
	type RouteEvaluation,
} from "../risk/route";
import { fetchRouteCandidates } from "../routing/osrm";
import {
	type AssembledRouteReview,
	assembleRouteReview,
	type ReviewAssessment,
	type ReviewEdge,
	type ReviewRoute,
} from "./assemble";
import {
	detourAnchors,
	groupSutranDetours,
	routeFollowsTramo,
	splitIntoPseudoEdges,
} from "./detours";

export interface EvaluateRouteReviewInput {
	db: Database;
	origin: LatLng;
	destination: LatLng;
	departureAt: Date;
	axleCount: number;
	osrmBaseUrl: string;
	now: Date;
	log: RequestLogger;
	fetchImpl?: typeof fetch;
}

const CONFIRMED_ROAD_STATUSES = ["interrumpido", "restringido"] as const;
const ILLAPA_ELIGIBILITY = {
	eligible: true,
	maxAxleCount: null,
	restriction: null,
};

async function loadAssessments(
	db: Database,
	bounds: Bounds,
	now: Date,
	excludedBounds?: Bounds,
): Promise<ReviewAssessment[]> {
	return db
		.select({
			segmentId: segmentRiskAssessment.segmentId,
			horizonHours: segmentRiskAssessment.horizonHours,
			score: segmentRiskAssessment.score,
			forecastPrecipitationMm: segmentRiskAssessment.forecastPrecipitationMm,
			components: segmentRiskAssessment.components,
			weatherFetchedAt: segmentRiskAssessment.weatherFetchedAt,
			assessedAt: segmentRiskAssessment.assessedAt,
		})
		.from(segmentRiskAssessment)
		.innerJoin(roadSegment, eq(roadSegment.id, segmentRiskAssessment.segmentId))
		.where(
			and(
				gt(segmentRiskAssessment.validUntil, now),
				withinBounds(roadSegment, bounds),
				excludedBounds &&
					or(
						lt(roadSegment.lat, excludedBounds.south),
						gt(roadSegment.lat, excludedBounds.north),
						lt(roadSegment.lng, excludedBounds.west),
						gt(roadSegment.lng, excludedBounds.east),
					),
			),
		);
}

export async function evaluateRouteReview({
	db,
	origin,
	destination,
	departureAt,
	axleCount,
	osrmBaseUrl,
	now,
	log,
	fetchImpl,
}: EvaluateRouteReviewInput): Promise<AssembledRouteReview> {
	const startedAt = performance.now();
	const elapsedMs = () => Math.round(performance.now() - startedAt);
	const bounds = routingBounds(origin, destination);
	const [{ edges, nodes }, routingAssessments, incidentRows, altRoutes] =
		await Promise.all([
			loadRoadGraph(db),
			loadAssessments(db, bounds, now),
			db
				.select({
					id: incident.id,
					source: incident.source,
					category: incident.category,
					severity: incident.severity,
					title: incident.title,
					description: incident.description,
					roadStatus: incident.roadStatus,
					roadCode: incident.roadCode,
					lat: incident.lat,
					lng: incident.lng,
					geometry: incident.geometry,
					occurredAt: incident.occurredAt,
					sourceUpdatedAt: incident.sourceUpdatedAt,
					firstSeenAt: incident.firstSeenAt,
					validFrom: incident.validFrom,
					validUntil: incident.validUntil,
				})
				.from(incident)
				.where(
					and(
						eq(incident.active, true),
						or(
							and(
								inArray(incident.roadStatus, CONFIRMED_ROAD_STATUSES),
								withinBounds(incident, bounds),
							),
							// Weather warnings are often province polygons without a
							// point, so they cannot be filtered by the routing box.
							and(
								inArray(incident.category, OFFICIAL_ALERT_CATEGORIES),
								or(isNull(incident.validUntil), gt(incident.validUntil, now)),
								or(isNotNull(incident.geometry), isNotNull(incident.lat)),
							),
						),
					),
				),
			db
				.select({
					id: poi.id,
					name: poi.name,
					geometry: poi.geometry,
					roadCodes: poi.roadCodes,
					attributes: poi.attributes,
				})
				.from(poi)
				.where(and(eq(poi.active, true), eq(poi.kind, "alt_route"))),
		]);
	const loadedMs = elapsedMs();

	const incidents = incidentRows.map(
		({ occurredAt, sourceUpdatedAt, firstSeenAt, ...row }) => ({
			...row,
			observedAt: sourceUpdatedAt ?? occurredAt ?? firstSeenAt,
		}),
	);
	const closures = incidents.flatMap((closure) =>
		closure.roadStatus === "interrumpido" &&
		closure.lat !== null &&
		closure.lng !== null
			? [{ ...closure, lat: closure.lat, lng: closure.lng }]
			: [],
	);
	const riskBySegment = new Map(
		routingAssessments.flatMap((assessment) =>
			assessment.horizonHours === ROUTE_REVIEW_ROUTING_HORIZON_HOURS
				? [[assessment.segmentId, assessment.score] as const]
				: [],
		),
	);
	const routingInput = { nodes, edges, riskBySegment, origin, destination };
	// The direct route ignores closures so an interruption on it is shown and
	// reroutes instead of silently disappearing from the list.
	const direct = findFastestRoute({
		...routingInput,
		blockedEdgeIds: new Set(),
	});
	const directGeometries = await fetchEdgeGeometries(db, direct?.edgeIds ?? []);

	// SUTRAN's detours apply when the stretch they replace is on the direct
	// route: for Lima to Huancayo, the Carretera Central's Rutas 1 to 5.
	const directLine: LineString | null = direct
		? simplify(
				{
					type: "LineString",
					coordinates: direct.edgeIds.flatMap((edgeId, index) => {
						const coordinates = directGeometries.get(edgeId)?.coordinates ?? [];
						return index === 0 ? coordinates : coordinates.slice(1);
					}),
				},
				{ tolerance: DETOUR_TRAMO_ROUTE_SIMPLIFY_TOLERANCE_DEG },
			)
		: null;
	const detours = directLine
		? groupSutranDetours(altRoutes)
				.filter(({ tramos }) =>
					tramos.some((tramo) => routeFollowsTramo(directLine, tramo)),
				)
				.flatMap(({ detours: regionDetours }) => regionDetours)
		: [];
	// OSRM takes about 0.7 s to answer the server, so the closures and the
	// other paths are worked out while the detours are being routed.
	const routingDetours = Promise.allSettled(
		detours.map(async (detour) => {
			const [route] = await fetchRouteCandidates({
				baseUrl: osrmBaseUrl,
				origin,
				destination,
				waypoints: detourAnchors(origin, detour.geometries),
				fetchImpl,
			});
			if (!route) throw new Error(`OSRM found no route through ${detour.id}`);
			return { detour, route };
		}),
	);

	const blockedEdgeIds = await blockClosedEdges(db, edges, closures);
	const avoiding = findRiskAwareRoutes({ ...routingInput, blockedEdgeIds });
	const evaluations: [string, RouteEvaluation | null][] = [
		["fastest", direct],
		["avoiding_closures", avoiding.fastest],
		["safest", avoiding.safest],
	];

	const edgesById = new Map(edges.map((edge) => [edge.id, edge]));
	const geometries = new Map([
		...directGeometries,
		...(await fetchEdgeGeometries(db, [
			...new Set(
				evaluations.flatMap(([, evaluation]) =>
					(evaluation?.edgeIds ?? []).filter(
						(edgeId) => !directGeometries.has(edgeId),
					),
				),
			),
		])),
	]);
	const illapaRoutes = evaluations.flatMap(
		([role, evaluation]): ReviewRoute[] =>
			evaluation
				? [
						{
							id: `illapa:${role}`,
							source: "illapa",
							name: null,
							roadCodes: null,
							eligibility: ILLAPA_ELIGIBILITY,
							edges: evaluation.edgeIds.flatMap((edgeId): ReviewEdge[] => {
								const edge = edgesById.get(edgeId);
								const geometry = geometries.get(edgeId);
								return edge && geometry ? [{ ...edge, geometry }] : [];
							}),
						},
					]
				: [],
	);
	const routedMs = elapsedMs();

	const routedDetours = await routingDetours;
	const detoursRoutedMs = elapsedMs();
	const detourFailures = routedDetours.flatMap((result) =>
		result.status === "rejected" ? [String(result.reason)] : [],
	);
	const detourRoutes = routedDetours.flatMap((result) =>
		result.status === "fulfilled" ? [result.value] : [],
	);

	// Detours leave the routing box, so their segments and assessments are
	// read for their own extent, minus the assessments already read for it.
	const [west, south, east, north] = bbox({
		type: "GeometryCollection",
		geometries: detourRoutes.map(({ route }) => route.geometry),
	});
	const detourBounds = { west, south, east, north };
	const [detourSegments, detourAssessments] =
		detourRoutes.length > 0
			? await Promise.all([
					db
						.select({
							id: roadSegment.id,
							lat: roadSegment.lat,
							lng: roadSegment.lng,
						})
						.from(roadSegment)
						.where(withinBounds(roadSegment, detourBounds)),
					loadAssessments(db, detourBounds, now, bounds),
				])
			: [[], []];
	const sutranRoutes = detourRoutes.map(
		({ detour, route }): ReviewRoute => ({
			id: detour.id,
			source: "sutran",
			name: detour.name,
			roadCodes: detour.roadCodes,
			eligibility: {
				eligible:
					detour.maxAxleCount === null || axleCount <= detour.maxAxleCount,
				maxAxleCount: detour.maxAxleCount,
				restriction: detour.restriction,
			},
			edges: splitIntoPseudoEdges(
				detour.id,
				route.geometry,
				route.durationS,
				detourSegments,
			),
		}),
	);

	const review = assembleRouteReview({
		routes: [...illapaRoutes, ...sutranRoutes],
		assessments: [...routingAssessments, ...detourAssessments],
		incidents,
		departureAt,
		now,
	});

	log.set({
		routeReview: {
			illapaRoutes: illapaRoutes.length,
			sutranDetours: detours.length,
			sutranDetourFailures: detourFailures,
			blockedEdges: blockedEdgeIds.size,
			// Milliseconds from the start at which each step ended. The detours
			// are routed while the closures and the other paths are worked out.
			timingsMs: {
				loaded: loadedMs,
				routed: routedMs,
				detoursRouted: detoursRoutedMs,
				assembled: elapsedMs(),
			},
		},
	});
	return review;
}
