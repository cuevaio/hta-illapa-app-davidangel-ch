import type { LineString } from "geojson";
import { describe, expect, it } from "vitest";

import {
	detourAnchors,
	groupSutranDetours,
	parseMaxAxleCount,
	routeFollowsTramo,
	splitIntoPseudoEdges,
} from "./detours";

describe("parseMaxAxleCount", () => {
	it("reads the axle limit from SUTRAN's restriction text", () => {
		expect(
			parseMaxAxleCount(
				"Transitabilidad de vehículos ligeros y medianos (hasta 3 ejes)",
			),
		).toBe(3);
		expect(
			parseMaxAxleCount(
				"Transitabilidad de vehículos ligeros,  medianos y grandes (hasta 5 ejes)",
			),
		).toBe(5);
	});

	it("reads a double-axle truck limit as two axles", () => {
		expect(
			parseMaxAxleCount("Vehiculos permitidos: hasta camiones doble eje"),
		).toBe(2);
	});

	it("returns null without a limit", () => {
		expect(parseMaxAxleCount(null)).toBeNull();
		expect(parseMaxAxleCount("Transitabilidad de vehículos")).toBeNull();
	});
});

const tramo: LineString = {
	type: "LineString",
	coordinates: [
		[-76.9, -11.95],
		[-76.6, -11.85],
	],
};

function altRoute(
	id: string,
	tipo: string,
	ruta: string,
	geometry: LineString | null,
	restriccion: string | null = null,
	distanciaKm: number | null = null,
) {
	return {
		id,
		name: ruta,
		geometry,
		roadCodes: [],
		attributes: {
			region: "carretera-central",
			tipo,
			ruta,
			restriccion,
			distanciaKm,
		},
	};
}

describe("groupSutranDetours", () => {
	it("groups detour fragments by region and route, shortest first, with their interrupted tramo", () => {
		const fragment = (offset: number): LineString => ({
			type: "LineString",
			coordinates: [
				[-77 + offset, -11.5],
				[-76.9 + offset, -11.4],
			],
		});
		const regions = groupSutranDetours([
			altRoute(
				"cc-1",
				"interrumpido",
				"CARRETERA CENTRAL: Lima-La Oroya",
				tramo,
			),
			altRoute(
				"cc-2",
				"alterna",
				"LIMA – CANTA – HUAYLLAY",
				fragment(0),
				"Transitabilidad de vehículos ligeros,  medianos y grandes (hasta 5 ejes)",
				218,
			),
			altRoute("cc-3", "alterna", "LIMA – CANTA – HUAYLLAY", fragment(0.1)),
			altRoute(
				"cc-4",
				"alterna",
				"HUARAL – ACOS – HUAYLLAY – UNISH",
				fragment(0.3),
				"Transitabilidad de vehículos ligeros y medianos (hasta 3 ejes)",
				184,
			),
			altRoute("other-1", "alterna", "SIN GEOMETRÍA", null),
		]);

		expect(regions).toEqual([
			{
				region: "carretera-central",
				tramos: [tramo],
				detours: [
					{
						id: "sutran:carretera-central:cc-4",
						name: "HUARAL – ACOS – HUAYLLAY – UNISH",
						roadCodes: [],
						restriction:
							"Transitabilidad de vehículos ligeros y medianos (hasta 3 ejes)",
						maxAxleCount: 3,
						geometries: [fragment(0.3)],
					},
					{
						id: "sutran:carretera-central:cc-2",
						name: "LIMA – CANTA – HUAYLLAY",
						roadCodes: [],
						restriction:
							"Transitabilidad de vehículos ligeros,  medianos y grandes (hasta 5 ejes)",
						maxAxleCount: 5,
						geometries: [fragment(0), fragment(0.1)],
					},
				],
			},
		]);
	});
});

describe("routeFollowsTramo", () => {
	const route: LineString = {
		type: "LineString",
		coordinates: [
			[-77.0, -12.0],
			[-76.9, -11.95],
			[-76.6, -11.85],
			[-75.2, -12.06],
		],
	};

	it("matches an interrupted tramo that lies on the route", () => {
		expect(routeFollowsTramo(route, tramo)).toBe(true);
	});

	it("rejects a tramo far from the route", () => {
		expect(
			routeFollowsTramo(route, {
				type: "LineString",
				coordinates: [
					[-77.6, -11.1],
					[-77.4, -10.9],
				],
			}),
		).toBe(false);
	});
});

describe("detourAnchors", () => {
	const far: LineString = {
		type: "LineString",
		coordinates: [
			[-76.0, -11.0],
			[-75.9, -11.1],
			[-75.8, -11.2],
		],
	};
	const near: LineString = {
		type: "LineString",
		coordinates: [
			[-76.9, -11.8],
			[-76.8, -11.7],
			[-76.7, -11.6],
		],
	};

	it("chains fragment midpoints from the origin", () => {
		expect(detourAnchors({ lat: -12.05, lng: -77.04 }, [far, near])).toEqual([
			{ lat: -11.7, lng: -76.8 },
			{ lat: -11.1, lng: -75.9 },
		]);
	});

	it("keeps at most eight anchors, the first and last of the chain included", () => {
		const fragments = Array.from(
			{ length: 20 },
			(_, index): LineString => ({
				type: "LineString",
				coordinates: [[-77 + index * 0.1, -11.5]],
			}),
		);
		const anchors = detourAnchors({ lat: -11.5, lng: -77.1 }, fragments);

		expect(anchors).toHaveLength(8);
		expect(anchors[0]).toEqual({ lat: -11.5, lng: -77 });
		expect(anchors.at(-1)?.lng).toBeCloseTo(-75.1);
	});
});

describe("splitIntoPseudoEdges", () => {
	// About 3.3 km east along latitude -11.9.
	const line: LineString = {
		type: "LineString",
		coordinates: Array.from({ length: 11 }, (_, index) => [
			-76.5 + index * 0.003,
			-11.9,
		]),
	};

	it("cuts the line into pieces of about 1 km that keep the total length and duration", () => {
		const edges = splitIntoPseudoEdges("sutran:x", line, 600, []);
		const totalLengthM = edges.reduce((total, edge) => total + edge.lengthM, 0);

		expect(edges.length).toBe(3);
		expect(totalLengthM).toBeCloseTo(3_268, -1);
		expect(
			edges.reduce((total, edge) => total + edge.travelTimeS, 0),
		).toBeCloseTo(600);
		expect(edges[0]).toMatchObject({
			id: "sutran:x:0",
			segmentId: null,
			roadCode: null,
		});
		expect(edges[1]?.geometry.coordinates[0]).toEqual(
			edges[0]?.geometry.coordinates.at(-1),
		);
	});

	it("assigns each piece the nearest assessed road segment within reach", () => {
		const edges = splitIntoPseudoEdges("sutran:x", line, 600, [
			{ id: "near", lat: -11.9, lng: -76.4955 },
			{ id: "far", lat: -11.8, lng: -76.4955 },
		]);

		expect(edges[0]?.segmentId).toBe("near");
		expect(edges.at(-1)?.segmentId).toBeNull();
	});
});
