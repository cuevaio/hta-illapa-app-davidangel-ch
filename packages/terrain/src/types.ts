import type { Camera, Group, Ray, Vector3, WebGLRenderer } from "three";

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

export interface TerrainOptions {
	renderer: WebGLRenderer;
	origin: GeoPoint;
	onTilesLoaded?: () => void;
}

export interface Terrain {
	readonly group: Group;
	update(camera: Camera): void;
	pick(worldRay: Ray): Vector3 | null;
	heightAt(point: LocalPoint): number | null;
	toLocal(point: GeoPoint): LocalPoint;
	toGeo(point: LocalPoint): GeoPoint;
	setClip(clip: TerrainClip | null): void;
	setOpacity(opacity: number): void;
	dispose(): void;
}
