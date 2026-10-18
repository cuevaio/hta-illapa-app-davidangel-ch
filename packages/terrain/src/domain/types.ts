/** A slippy-map tile address (XYZ scheme, y grows southward). */
export interface TileId {
	readonly z: number;
	readonly x: number;
	readonly y: number;
}

export interface Vec3 {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

export interface LonLat {
	readonly lon: number;
	readonly lat: number;
}

export interface LonLatBounds {
	readonly west: number;
	readonly south: number;
	readonly east: number;
	readonly north: number;
}

/** Axis-aligned rectangle in Web Mercator meters (y grows northward). */
export interface MercatorBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

/** Minimal view-frustum abstraction so the domain does not depend on a 3D engine. */
export interface FrustumLike {
	intersectsBox(min: Vec3, max: Vec3): boolean;
}
