import type { IncidentCategory } from "@hack-the-andes-project/db/schema/scraper";

import {
	COEN_API_BASE,
	COEN_RECENT_DAYS,
	INDECI_HAZARD_CODE_PREFIX_PATTERN,
	INDECI_MAPSERVER_BASE,
} from "../constants";
import {
	type GeoJsonFeature,
	geoJsonFeatureCollectionSchema,
	queryArcgisLayer,
} from "../lib/arcgis";
import { parseIsoDate } from "../lib/dates";
import { geometryCenter } from "../lib/geo";
import { stripHtml } from "../lib/html";
import { fetchJson, withQuery } from "../lib/http";
import { numberAt, stringAt } from "../lib/props";
import type {
	IncidentRecord,
	IncidentSource,
	PoiRecord,
	PoiSource,
} from "./types";

const CATEGORY_BY_HAZARD_KEYWORD: [string, IncidentCategory][] = [
	["FORESTAL", "wildfire"],
	["INCENDIO", "fire"],
	["SISMO", "earthquake"],
	["INUNDACI", "flood"],
	["DESBORDE", "flood"],
	["DESLIZAMIENTO", "landslide"],
	["DERRUMBE", "landslide"],
	["HUAICO", "landslide"],
	["HUAYCO", "landslide"],
	["MOVIMIENTO EN MASA", "landslide"],
	["ALUD", "landslide"],
	["ACCIDENTE DE TRANSITO", "road_accident"],
	["ACCIDENTE DE TRÁNSITO", "road_accident"],
	["LLUVIA", "weather"],
	["VIENTO", "weather"],
	["HELADA", "weather"],
	["NEVADA", "weather"],
	["GRANIZ", "weather"],
	["TORMENTA", "weather"],
	["DERRAME", "hazmat"],
	["EXPLOSI", "hazmat"],
];

function categorizeHazard(label: string): IncidentCategory {
	const upper = label.toUpperCase();
	return (
		CATEGORY_BY_HAZARD_KEYWORD.find(([keyword]) =>
			upper.includes(keyword),
		)?.[1] ?? "other"
	);
}

function toCoenIncident(feature: GeoJsonFeature): IncidentRecord | null {
	const properties = feature.properties;
	const sourceId = stringAt(properties, "id");
	if (!sourceId) {
		return null;
	}
	const hazard = stringAt(properties, "Tipo de peligro") ?? "EMERGENCIA";
	const narrative = stringAt(properties, "Hechos");
	const fireState = stringAt(properties, "Estado de incendio");
	const center = geometryCenter(feature.geometry);
	const distrito = stringAt(properties, "Distrito");
	const provincia = stringAt(properties, "Provincia");
	const region = stringAt(properties, "Departamento");
	return {
		sourceId,
		category: categorizeHazard(hazard),
		severity: fireState === "active" ? "critical" : "warning",
		title: `${hazard.replace(INDECI_HAZARD_CODE_PREFIX_PATTERN, "")} · ${[distrito, provincia, region].filter(Boolean).join(", ")}`,
		description: narrative ? stripHtml(narrative) : null,
		status: fireState ?? stringAt(properties, "Estado"),
		roadStatus: null,
		roadCode: null,
		roadName: null,
		roadKm: null,
		lat: center?.lat ?? null,
		lng: center?.lng ?? null,
		geometry: feature.geometry,
		region,
		provincia,
		distrito,
		occurredAt: parseIsoDate(properties["Fecha de ocurrencia"]),
		sourceUpdatedAt: parseIsoDate(properties["Fecha de actualización"]),
		validFrom: null,
		validUntil: null,
		attributes: properties,
	};
}

// The 24h and 2-day windows overlap and expose slightly different fields, so
// both are read and merged by id, the wider window winning on conflicts.
export const indeciCoenEmergenciesSource: IncidentSource = {
	kind: "incident",
	id: "indeci_coen_emergencies",
	schedule: "frequent",
	snapshot: "full",
	async fetch() {
		const [lastDay, recent] = await Promise.all([
			fetchJson(`${COEN_API_BASE}/geojson-last-twenty-four`),
			fetchJson(
				withQuery(`${COEN_API_BASE}/geojson-last-emergencies`, {
					daysAgo: COEN_RECENT_DAYS,
				}),
			),
		]);
		const byId = new Map<string, IncidentRecord>();
		for (const payload of [lastDay, recent]) {
			for (const feature of geoJsonFeatureCollectionSchema.parse(payload)
				.features) {
				const record = toCoenIncident(feature);
				if (record) {
					byId.set(record.sourceId, record);
				}
			}
		}
		return [...byId.values()];
	},
};

export const indeciReliefWarehousesSource: PoiSource = {
	kind: "poi",
	id: "indeci_relief_warehouses",
	schedule: "daily",
	snapshot: "full",
	async fetch() {
		const features = await queryArcgisLayer({
			layerUrl: `${INDECI_MAPSERVER_BASE}/1`,
			where: "1=1",
			orderByField: "OBJECTID",
		});
		return features.flatMap((feature): PoiRecord[] => {
			const properties = feature.properties;
			const objectId = numberAt(properties, "OBJECTID");
			if (objectId === null) {
				return [];
			}
			const center = geometryCenter(feature.geometry);
			return [
				{
					sourceId: String(objectId),
					kind: "relief_warehouse",
					name:
						stringAt(properties, "INFRAESTRUCTURA") ??
						`Almacén INDECI ${objectId}`,
					lat: center?.lat ?? numberAt(properties, "LATITUD"),
					lng: center?.lng ?? numberAt(properties, "LONGITUD"),
					geometry: feature.geometry,
					region: stringAt(properties, "DEPARTAMENTO"),
					provincia: stringAt(properties, "PROVINCIA"),
					distrito: stringAt(properties, "DISTRITO"),
					roadCodes: null,
					attributes: properties,
				},
			];
		});
	},
};
