import { describe, expect, it } from "vitest";

import { findRiskAwareRoutes, type RoutingEdge } from "./route";

// A (Lima side) → D (Huancayo side) through either B (fast, risky segment)
// or C (slower, safe), all ~1 km apart.
const nodes = [
	{ id: 1, lat: -12.0, lng: -76.9 },
	{ id: 2, lat: -11.99, lng: -76.89 },
	{ id: 3, lat: -12.01, lng: -76.89 },
	{ id: 4, lat: -12.0, lng: -76.88 },
];

function edge(
	id: string,
	fromNodeId: number,
	toNodeId: number,
	travelTimeS: number,
	segmentId: string | null,
): RoutingEdge {
	return { id, fromNodeId, toNodeId, lengthM: 1_000, travelTimeS, segmentId };
}

const edges = [
	edge("A-B", 1, 2, 60, "risky"),
	edge("B-D", 2, 4, 60, "risky"),
	edge("A-C", 1, 3, 90, "safe"),
	edge("C-D", 3, 4, 90, "safe"),
	edge("D-A", 4, 1, 10, null),
];

const riskBySegment = new Map([
	["risky", 90],
	["safe", 10],
]);

const origin = { lat: -12.0, lng: -76.9 };
const destination = { lat: -12.0, lng: -76.88 };

describe("findRiskAwareRoutes", () => {
	it("returns the fastest route and a slower route with less exposure", () => {
		const routes = findRiskAwareRoutes({
			nodes,
			edges,
			riskBySegment,
			blockedEdgeIds: new Set(),
			origin,
			destination,
		});

		expect(routes.fastest?.edgeIds).toEqual(["A-B", "B-D"]);
		expect(routes.fastest).toMatchObject({
			distanceM: 2_000,
			durationS: 120,
			meanRiskScore: 90,
			maxRiskScore: 90,
			highRiskDistanceM: 2_000,
			unassessedDistanceM: 0,
		});
		expect(routes.safest?.edgeIds).toEqual(["A-C", "C-D"]);
		expect(routes.safest).toMatchObject({
			durationS: 180,
			meanRiskScore: 10,
			highRiskDistanceM: 0,
		});
	});

	it("respects edge direction", () => {
		const routes = findRiskAwareRoutes({
			nodes,
			edges,
			riskBySegment,
			blockedEdgeIds: new Set(),
			origin: destination,
			destination: origin,
		});

		expect(routes.fastest?.edgeIds).toEqual(["D-A"]);
		expect(routes.fastest?.unassessedDistanceM).toBe(1_000);
	});

	it("never routes through official closures", () => {
		const routes = findRiskAwareRoutes({
			nodes,
			edges,
			riskBySegment,
			blockedEdgeIds: new Set(["B-D"]),
			origin,
			destination,
		});

		expect(routes.fastest?.edgeIds).toEqual(["A-C", "C-D"]);
		expect(routes.safest?.edgeIds).toEqual(["A-C", "C-D"]);
	});

	it("returns no routes when closures disconnect the graph", () => {
		const routes = findRiskAwareRoutes({
			nodes,
			edges,
			riskBySegment,
			blockedEdgeIds: new Set(["B-D", "C-D"]),
			origin,
			destination,
		});

		expect(routes).toEqual({ fastest: null, safest: null });
	});

	it("takes the open one of two parallel roads when the faster one is closed", () => {
		const routes = findRiskAwareRoutes({
			nodes,
			edges: [...edges, edge("B-D old road", 2, 4, 70, "risky")],
			riskBySegment,
			blockedEdgeIds: new Set(["B-D"]),
			origin,
			destination,
		});

		expect(routes.fastest?.edgeIds).toEqual(["A-B", "B-D old road"]);
	});

	it("keeps a closure to its own call when the graph is reused", () => {
		const routingInput = { nodes, edges, riskBySegment, origin, destination };
		findRiskAwareRoutes({ ...routingInput, blockedEdgeIds: new Set(["B-D"]) });
		const routes = findRiskAwareRoutes({
			...routingInput,
			blockedEdgeIds: new Set(),
		});

		expect(routes.fastest?.edgeIds).toEqual(["A-B", "B-D"]);
	});

	it("returns no routes when an endpoint is too far from the graph", () => {
		const routes = findRiskAwareRoutes({
			nodes,
			edges,
			riskBySegment,
			blockedEdgeIds: new Set(),
			origin: { lat: -13.5, lng: -76.9 },
			destination,
		});

		expect(routes).toEqual({ fastest: null, safest: null });
	});
});
