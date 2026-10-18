import type {
	IncidentSeverity,
	RoadStatus,
} from "@hack-the-andes-project/db/schema/scraper";
import { z } from "zod";

import {
	MS_PER_HOUR,
	SRATMA_FETCH_CONCURRENCY,
	SRATMA_PHOTO_PREFIX,
	SRATMA_ROUTE_IMPACT_WINDOW_MS,
} from "../constants";
import { mapWithConcurrency } from "../lib/concurrency";
import { parseLimaDateTime } from "../lib/dates";
import { isPlausibleLatLng, pointGeometry } from "../lib/geo";
import { fetchJson, UpstreamError, withQuery } from "../lib/http";
import {
	type AccidentRoadStatus,
	classifyAccidentRoadStatus,
} from "../lib/jev";
import { SEVERITY_BY_ROAD_STATUS } from "./sutran";
import type { IncidentRecord, IncidentSource, ScrapeContext } from "./types";

// The exact filter object the SRATMA viewer sends on load: every reporting
// entity, no map layers, and only accidents from the last 30 days
// (`mayor30: false`). A partial object comes back as an empty 200, so every
// key is sent.
const RECENT_ACCIDENTS_FILTERS = {
	cod_accidente_transito: "",
	cod_ubigeo: "",
	codruta: "",
	codrutanacional: "",
	codrutadepartamental: "",
	codrutavecinal: "",
	fecha_inicial: null,
	fecha_final: null,
	mayor30: false,
	waze: false,
	comisaria: false,
	puentes: false,
	peajes: false,
	anio: 0,
	redvial: false,
	concesionados: false,
	id_clase_accidente: 0,
	otros_clase_accidente: "",
	redvialDepartamental: false,
	redvialNacional: false,
	redvialVecinal: false,
	es_dsv: true,
	es_concesionaria: true,
	es_pnp: true,
	es_serenazgo: true,
	tramosTca: true,
};

// Police reports fill the narrative with a bare yes/no answer.
const NON_NARRATIVE_ANSWERS = new Set(["SI", "NO"]);
// "Km 108 300", "018 900" (concessionaire) or "... KM 431 500" (police).
const ROAD_KM_PATTERN = /(?:^|\bkm\.?\s*)(\d{1,4})\s+(\d{3})\b/i;
const PHOTO_FORMATS = [
	{
		signature: [0xff, 0xd8, 0xff],
		extension: "jpg",
		contentType: "image/jpeg",
	},
	{
		signature: [0x89, 0x50, 0x4e, 0x47],
		extension: "png",
		contentType: "image/png",
	},
];

const listingFeatureSchema = z.looseObject({
	properties: z.looseObject({ id_accidente: z.number() }),
	iddist: z.string().nullish(),
	es_concesionario: z.boolean().nullish(),
	es_dsv: z.boolean().nullish(),
	// null is a real upstream value here; it must not be read as false.
	es_serenazgo: z.boolean().nullish(),
});

const listingSchema = z.looseObject({
	accidente: z.looseObject({ features: z.array(listingFeatureSchema) }),
});

const detailSchema = z.looseObject({
	id_accidente_transito: z.number(),
	fecha_registro: z.string(),
	hora_registro: z.string(),
	clase_accidente: z.string(),
	direccion: z.string().nullable(),
	latitud: z.string().nullable(),
	longitud: z.string().nullable(),
	detalle_hechos: z.string().nullable(),
	departamento: z.string().nullable(),
	provincia: z.string().nullable(),
	distrito: z.string().nullable(),
	estado: z.string().nullable(),
	nro_fallecido: z.number().nullable(),
	nro_lesionado: z.number().nullable(),
	nro_vehiculos: z.number().nullable(),
	entidad: z.string().nullable(),
});

interface AccidentFailure {
	accidentId: number;
	error: string;
}

interface SratmaRunSummary {
	listed: number;
	recent: number;
	newAccidentLagHours: number[];
	jevFailures: AccidentFailure[];
	photos: {
		listingError: string | null;
		stored: number;
		uploaded: number;
		missing: number;
		failures: AccidentFailure[];
	};
}

export interface RouteImpact {
	severity: IncidentSeverity;
	roadStatus: RoadStatus | null;
	classification: AccidentRoadStatus | null;
}

export interface SratmaAccident {
	feature: z.infer<typeof listingFeatureSchema>;
	detail: z.infer<typeof detailSchema>;
	occurredAt: Date | null;
	routeImpact: RouteImpact;
	imageUrl: string | null;
}

const CONTEXT_ONLY_IMPACT: RouteImpact = {
	severity: "info",
	roadStatus: null,
	classification: null,
};

export function parseRoadKm(address: string | null): string | null {
	const match = address?.trim().match(ROAD_KM_PATTERN);
	return match?.[1] && match[2] ? `${Number(match[1])}+${match[2]}` : null;
}

function countLabel(
	count: number | null,
	singular: string,
	plural: string,
): string | null {
	return count === null ? null : `${count} ${count === 1 ? singular : plural}`;
}

export function toSratmaIncident({
	feature,
	detail,
	occurredAt,
	routeImpact,
	imageUrl,
}: SratmaAccident): IncidentRecord {
	const narrative = detail.detalle_hechos?.trim();
	const tally = [
		countLabel(detail.nro_fallecido, "fallecido", "fallecidos"),
		countLabel(detail.nro_lesionado, "lesionado", "lesionados"),
		countLabel(detail.nro_vehiculos, "vehículo", "vehículos"),
		detail.entidad && `Reporta: ${detail.entidad}`,
	]
		.filter(Boolean)
		.join(" · ");
	const description = [
		narrative && !NON_NARRATIVE_ANSWERS.has(narrative.toUpperCase())
			? narrative
			: null,
		tally,
	]
		.filter(Boolean)
		.join("\n");
	const point =
		detail.latitud && detail.longitud
			? { lat: Number(detail.latitud), lng: Number(detail.longitud) }
			: null;
	const location = point && isPlausibleLatLng(point) ? point : null;
	return {
		sourceId: String(detail.id_accidente_transito),
		category: "road_accident",
		severity: routeImpact.severity,
		title: detail.direccion
			? `${detail.clase_accidente} · ${detail.direccion}`
			: detail.clase_accidente,
		description: description.length > 0 ? description : null,
		imageUrl,
		status: detail.estado,
		roadStatus: routeImpact.roadStatus,
		roadCode: null,
		roadName: null,
		roadKm: parseRoadKm(detail.direccion),
		lat: location?.lat ?? null,
		lng: location?.lng ?? null,
		geometry: location ? pointGeometry(location) : null,
		region: detail.departamento,
		provincia: detail.provincia,
		distrito: detail.distrito,
		occurredAt,
		sourceUpdatedAt: null,
		validFrom: null,
		validUntil: null,
		attributes: {
			...detail,
			listing: {
				iddist: feature.iddist,
				es_concesionario: feature.es_concesionario,
				es_dsv: feature.es_dsv,
				es_serenazgo: feature.es_serenazgo,
			},
			routeImpact: routeImpact.classification,
		},
	};
}

// The listing has no photo flag, so every accident without a stored photo is
// asked again each run: about half answer 404, which does not rule out a
// photo being attached later.
async function storePhoto(
	accidentId: number,
	context: ScrapeContext,
): Promise<string | null> {
	let encodedPhoto: unknown;
	try {
		encodedPhoto = await fetchJson(
			withQuery(`${context.sratmaApiBase}/DescargaArchivo`, {
				ipInput: accidentId,
			}),
		);
	} catch (error) {
		if (error instanceof UpstreamError && error.status === 404) {
			return null;
		}
		throw error;
	}
	const photoBytes = Uint8Array.from(
		atob(z.string().min(1).parse(encodedPhoto)),
		(character) => character.charCodeAt(0),
	);
	const format = PHOTO_FORMATS.find(({ signature }) =>
		signature.every((byte, index) => photoBytes[index] === byte),
	);
	if (!format) {
		throw new Error(`Unrecognized SRATMA photo format for ${accidentId}`);
	}
	const key = `${SRATMA_PHOTO_PREFIX}${accidentId}.${format.extension}`;
	await context.mediaBucket.put(key, photoBytes, format.contentType);
	return context.mediaBucket.publicUrl(key);
}

export const sratmaAccidentsSource: IncidentSource = {
	kind: "incident",
	id: "sratma_accidents",
	schedule: "hourly",
	snapshot: "full",
	async fetch(context) {
		const listing = listingSchema.parse(
			await fetchJson(
				withQuery(`${context.sratmaApiBase}/listarAccidenteMapa`, {
					ipInput: JSON.stringify(RECENT_ACCIDENTS_FILTERS),
				}),
			),
		);
		const features = [
			...new Map(
				listing.accidente.features.map((feature) => [
					feature.properties.id_accidente,
					feature,
				]),
			).values(),
		];
		// An unexpected filter or upstream change answers with an empty 200;
		// a nationwide 30-day window is never empty, so fail instead of letting
		// the full snapshot deactivate every stored accident.
		if (features.length === 0) {
			throw new Error("SRATMA returned no accidents for the last 30 days");
		}
		const summary: SratmaRunSummary = {
			listed: features.length,
			recent: 0,
			newAccidentLagHours: [],
			jevFailures: [],
			photos: {
				listingError: null,
				stored: 0,
				uploaded: 0,
				missing: 0,
				failures: [],
			},
		};
		let photoKeyByAccidentId: Map<string, string> | null = null;
		try {
			const storedKeys =
				await context.mediaBucket.listKeys(SRATMA_PHOTO_PREFIX);
			photoKeyByAccidentId = new Map(
				storedKeys.map((key) => [
					key.slice(SRATMA_PHOTO_PREFIX.length, key.lastIndexOf(".")),
					key,
				]),
			);
		} catch (error) {
			summary.photos.listingError = String(error);
		}
		const records = await mapWithConcurrency(
			features,
			SRATMA_FETCH_CONCURRENCY,
			async (feature) => {
				const accidentId = feature.properties.id_accidente;
				const detail = detailSchema.parse(
					await fetchJson(
						withQuery(
							`${context.sratmaApiBase}/listarAccidenteMapaInformacion`,
							{
								ipInput: JSON.stringify({ id_accidente_transito: accidentId }),
							},
						),
					),
				);
				const occurredAt = parseLimaDateTime(
					detail.fecha_registro,
					detail.hora_registro,
				);
				const ageMs = occurredAt
					? context.now.getTime() - occurredAt.getTime()
					: null;
				if (ageMs !== null && !context.knownSourceIds.has(String(accidentId))) {
					summary.newAccidentLagHours.push(Math.round(ageMs / MS_PER_HOUR));
				}

				let routeImpact = CONTEXT_ONLY_IMPACT;
				if (
					ageMs !== null &&
					ageMs >= 0 &&
					ageMs <= SRATMA_ROUTE_IMPACT_WINDOW_MS
				) {
					summary.recent += 1;
					try {
						const classification = await classifyAccidentRoadStatus(
							context.jevApiKey,
							{
								accidentClass: detail.clase_accidente,
								narrative: detail.detalle_hechos,
								address: detail.direccion,
								location: [
									detail.distrito,
									detail.provincia,
									detail.departamento,
								]
									.filter(Boolean)
									.join(", "),
								deaths: detail.nro_fallecido,
								injured: detail.nro_lesionado,
								vehicles: detail.nro_vehiculos,
								reportedBy: detail.entidad,
								hoursSinceAccident: Math.round(ageMs / MS_PER_HOUR),
							},
						);
						routeImpact = {
							severity: SEVERITY_BY_ROAD_STATUS[classification.roadStatus],
							roadStatus: classification.roadStatus,
							classification,
						};
					} catch (error) {
						// Fail open: a recent accident Jev could not judge still alerts.
						summary.jevFailures.push({ accidentId, error: String(error) });
						routeImpact = {
							severity: "warning",
							roadStatus: null,
							classification: null,
						};
					}
				}

				let imageUrl: string | null = null;
				const storedKey = photoKeyByAccidentId?.get(String(accidentId));
				if (storedKey) {
					summary.photos.stored += 1;
					imageUrl = context.mediaBucket.publicUrl(storedKey);
				} else if (photoKeyByAccidentId) {
					try {
						imageUrl = await storePhoto(accidentId, context);
						if (imageUrl) {
							summary.photos.uploaded += 1;
						} else {
							summary.photos.missing += 1;
						}
					} catch (error) {
						summary.photos.failures.push({ accidentId, error: String(error) });
					}
				}

				return toSratmaIncident({
					feature,
					detail,
					occurredAt,
					routeImpact,
					imageUrl,
				});
			},
		);
		context.log.set({ sratma: summary });
		return records;
	},
};
