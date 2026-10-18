import type { LatLng } from "../hazards/types";

export const ROUTE_REVIEW_PLACE_IDS = [
	"lima",
	"huancayo",
	"la_oroya",
	"tarma",
	"jauja",
	"cerro_de_pasco",
	"huanuco",
	"canete",
	"pisco",
	"ayacucho",
] as const;
export type RouteReviewPlaceId = (typeof ROUTE_REVIEW_PLACE_IDS)[number];

export interface RouteReviewPlace extends LatLng {
	name: string;
	region: string;
}

export const ROUTE_REVIEW_PLACES: Record<RouteReviewPlaceId, RouteReviewPlace> =
	{
		lima: { name: "Lima", region: "Lima", lat: -12.0464, lng: -77.0428 },
		huancayo: {
			name: "Huancayo",
			region: "Junín",
			lat: -12.0651,
			lng: -75.2049,
		},
		la_oroya: {
			name: "La Oroya",
			region: "Junín",
			lat: -11.5186,
			lng: -75.9006,
		},
		tarma: { name: "Tarma", region: "Junín", lat: -11.4194, lng: -75.69 },
		jauja: { name: "Jauja", region: "Junín", lat: -11.7758, lng: -75.4997 },
		cerro_de_pasco: {
			name: "Cerro de Pasco",
			region: "Pasco",
			lat: -10.6864,
			lng: -76.2622,
		},
		huanuco: {
			name: "Huánuco",
			region: "Huánuco",
			lat: -9.9306,
			lng: -76.2422,
		},
		canete: { name: "Cañete", region: "Lima", lat: -13.0779, lng: -76.387 },
		pisco: { name: "Pisco", region: "Ica", lat: -13.7103, lng: -76.2054 },
		ayacucho: {
			name: "Ayacucho",
			region: "Ayacucho",
			lat: -13.1588,
			lng: -74.2239,
		},
	};
