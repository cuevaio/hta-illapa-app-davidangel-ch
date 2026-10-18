import type { Structure } from "@hack-the-andes-project/api/structure-schemas";

const seededAt = new Date("2026-10-18T00:00:00.000Z");

// Real PE-22 structures from OpenStreetMap (ways 508508478, 190632685 and the
// Chacahuaro realignment 585147839/524177328/591082781). The 30 m DEM puts the
// Cacray portals on the gorge walls, so the tunnel keeps a realistic 3 % grade
// instead of the sampled elevations.
export const SEEDED_STRUCTURES: Structure[] = [
	{
		id: "seed-puente-habich",
		name: "Puente Habich",
		status: "operational",
		notes:
			"Carretera Central, km 70 aprox. Cruza el río Rímac entre Surco y Matucana.",
		anchor: { lat: -11.86507605, lng: -76.4245926, elevationM: 2164 },
		template: {
			kind: "bridge",
			start: { x: -33.2, y: -1, z: 54.7 },
			end: { x: 33.2, y: 2.5, z: -54.7 },
			deckWidthM: 10,
			pierCount: 2,
			deckMaterial: "concrete",
		},
		elements: [],
		createdAt: seededAt,
		updatedAt: seededAt,
	},
	{
		id: "seed-tunel-cacray",
		name: "Túnel Cacray",
		status: "operational",
		notes: "Carretera Central, km 98 aprox., junto al cañón del Infiernillo.",
		anchor: { lat: -11.7393082, lng: -76.2785777, elevationM: 3346 },
		template: {
			kind: "tunnel",
			start: { x: -179.7, y: 6, z: 67.8 },
			end: { x: 179.7, y: -6, z: -67.8 },
			sectionWidthM: 10,
			sectionHeightM: 7,
			shape: "horseshoe",
		},
		elements: [],
		createdAt: seededAt,
		updatedAt: seededAt,
	},
	{
		id: "seed-variante-chacahuaro",
		name: "Variante Chacahuaro",
		status: "operational",
		notes:
			"Realineamiento de la Carretera Central en Chacahuaro, km 81 aprox. Incluye el Túnel Chacahuaro II (251 m).",
		anchor: { lat: -11.814787, lng: -76.355514, elevationM: 2520 },
		template: {
			kind: "bypass",
			points: [
				{ x: 0, y: 0.4, z: 0 },
				{ x: 23.5, y: 0.3, z: -17.2 },
				{ x: 41.1, y: 0.8, z: -38.9 },
				{ x: 57.4, y: 2.3, z: -66.9 },
				{ x: 61.3, y: 1.3, z: -81.5 },
				{ x: 79, y: -4.2, z: -176.7 },
				{ x: 88.3, y: 1.6, z: -215.8 },
				{ x: 101.7, y: 9.5, z: -248.1 },
				{ x: 115.7, y: 18.5, z: -266.9 },
				{ x: 142.6, y: 35.3, z: -294.6 },
				{ x: 170.4, y: 60.6, z: -314 },
				{ x: 297.2, y: 90.6, z: -376.2 },
				{ x: 461.5, y: 25.6, z: -459.1 },
			],
			laneCount: 2,
			laneWidthM: 3.3,
		},
		elements: [],
		createdAt: seededAt,
		updatedAt: seededAt,
	},
];
