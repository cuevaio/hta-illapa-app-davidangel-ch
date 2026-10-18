import type {
	Camera,
	Ray,
	Scene,
	TransformNode,
	Vector3,
} from "@babylonjs/core";

import type { GeoPoint, LocalPoint, TerrainClip } from "../types";

// The host scene must set useRightHandedSystem = true: local metres keep the
// three.js frame the structures are stored in (+x east, +y up, -z north).
export interface BabylonTerrainOptions {
	scene: Scene;
	origin: GeoPoint;
	onTilesLoaded?: () => void;
}

export interface BabylonTerrain {
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
