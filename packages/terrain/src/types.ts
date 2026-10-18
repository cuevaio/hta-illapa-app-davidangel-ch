export interface GeoPoint {
	lat: number;
	lng: number;
}

export interface LocalPoint {
	x: number;
	z: number;
}

export interface TerrainClip {
	center: LocalPoint;
	sizeM: number;
}
