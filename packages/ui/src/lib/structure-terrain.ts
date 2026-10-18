import type { Camera, Ray, TransformNode, Vector3 } from "@babylonjs/core";

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

// Local metres in the frame structures are stored in: right-handed, +x east,
// +y up, -z north, so the host scene sets useRightHandedSystem = true.
export interface StructureTerrain {
	readonly root: TransformNode;
	update(camera: Camera): void;
	pick(worldRay: Ray): Vector3 | null;
	heightAt(point: LocalPoint): number | null;
	toLocal(point: GeoPoint): LocalPoint;
	toGeo(point: LocalPoint): GeoPoint;
	setClip(clip: TerrainClip | null): void;
	setOpacity(opacity: number): void;
	dispose(): void;
}
