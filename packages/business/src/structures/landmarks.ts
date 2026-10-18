export const PE22_TERRAIN_ORIGIN = { lat: -11.84, lng: -76.39 };

export interface CorridorLandmark {
	name: string;
	lat: number;
	lng: number;
}

// OpenStreetMap place nodes along the PE-22 (Carretera Central), Lima → La Oroya.
export const PE22_LANDMARKS: CorridorLandmark[] = [
	{ name: "Chosica", lat: -11.9368, lng: -76.6969 },
	{ name: "Ricardo Palma", lat: -11.9237, lng: -76.6649 },
	{ name: "San Jerónimo de Surco", lat: -11.8839, lng: -76.4403 },
	{ name: "Matucana", lat: -11.8447, lng: -76.3861 },
	{ name: "Chacahuaro", lat: -11.8162, lng: -76.3576 },
	{ name: "San Mateo de Huanchor", lat: -11.7586, lng: -76.3 },
	{ name: "Chicla", lat: -11.705, lng: -76.2686 },
	{ name: "Casapalca", lat: -11.6511, lng: -76.2381 },
	{ name: "Ticlio", lat: -11.5985, lng: -76.1932 },
	{ name: "Morococha", lat: -11.6063, lng: -76.1326 },
	{ name: "La Oroya", lat: -11.5201, lng: -75.9014 },
];
