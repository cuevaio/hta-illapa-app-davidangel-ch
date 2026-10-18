import { bypassWidthM } from "@hack-the-andes-project/business/structures/geometry";
import type { Terrain } from "@hack-the-andes-project/terrain/types";
import { Box3, Euler, MathUtils, type PerspectiveCamera, Vector3 } from "three";
import type { SceneInsets, SceneStructure } from "../../lib/structure-scene";
import {
	CAMERA_FOCUS_ELEVATION_RATIO,
	CAMERA_FOCUS_FILL_RATIO,
	CAMERA_FOCUS_MIN_DISTANCE_M,
	CAMERA_FRAMING_ITERATIONS_COUNT,
	CAMERA_MAX_DISTANCE_M,
	DECK_THICKNESS_M,
} from "./constants";

interface ViewportSize {
	width: number;
	height: number;
}
export interface CameraFrame {
	position: Vector3;
	target: Vector3;
}

export function getStructureFramePoints(
	structure: SceneStructure,
	terrain: Terrain,
): Vector3[] {
	const localAnchor = terrain.toLocal(structure.anchor);
	const anchor = new Vector3(
		localAnchor.x,
		structure.anchor.elevationM,
		localAnchor.z,
	);
	const template = structure.template;
	const points: Vector3[] = [];
	if (template.kind !== "entity") {
		const path =
			template.kind === "bypass"
				? template.points
				: [template.start, template.end];
		for (let pointIndex = 0; pointIndex < path.length; pointIndex++) {
			const point = path[pointIndex];
			if (!point) continue;
			const previous = path[Math.max(0, pointIndex - 1)] ?? point;
			const next = path[Math.min(path.length - 1, pointIndex + 1)] ?? point;
			const across = new Vector3(
				-(next.z - previous.z),
				0,
				next.x - previous.x,
			).normalize();
			const halfWidthM =
				template.kind === "bridge"
					? template.deckWidthM / 2
					: template.kind === "tunnel"
						? template.sectionWidthM / 2
						: bypassWidthM(template) / 2;
			const base = new Vector3(point.x, point.y, point.z).add(anchor);
			const minimumHeightM = template.kind === "bridge" ? -DECK_THICKNESS_M : 0;
			const maximumHeightM =
				template.kind === "tunnel" ? template.sectionHeightM : 0;
			if (template.kind === "bypass") base.y = terrain.heightAt(base) ?? base.y;
			for (const side of [-1, 1]) {
				for (const heightM of [minimumHeightM, maximumHeightM])
					points.push(
						base
							.clone()
							.addScaledVector(across, halfWidthM * side)
							.add(new Vector3(0, heightM, 0)),
					);
			}
		}
	}
	for (const element of structure.elements) {
		const rotation = new Euler(
			MathUtils.degToRad(element.rotationDeg.x),
			MathUtils.degToRad(element.rotationDeg.y),
			MathUtils.degToRad(element.rotationDeg.z),
		);
		for (const eastM of [-element.widthM / 2, element.widthM / 2]) {
			for (const heightM of [0, element.heightM]) {
				for (const southM of [-element.depthM / 2, element.depthM / 2])
					points.push(
						new Vector3(eastM, heightM, southM)
							.applyEuler(rotation)
							.add(
								new Vector3(
									element.position.x,
									element.position.y,
									element.position.z,
								),
							)
							.add(anchor),
					);
			}
		}
	}
	return points.length ? points : [anchor];
}

export function frameCameraPoints(
	camera: PerspectiveCamera,
	points: Vector3[],
	insets: SceneInsets,
	viewport: ViewportSize,
	fillRatio = CAMERA_FOCUS_FILL_RATIO,
): CameraFrame {
	const target = new Box3().setFromPoints(points).getCenter(new Vector3());
	const direction = new Vector3(1, CAMERA_FOCUS_ELEVATION_RATIO, 1).normalize();
	const projectionCamera = camera.clone();
	const freeWidthPx = Math.max(
		1,
		viewport.width - insets.leftPx - insets.rightPx,
	);
	const freeHeightPx = Math.max(
		1,
		viewport.height - insets.topPx - insets.bottomPx,
	);
	const projection = new Vector3();
	let minimumDistanceM = CAMERA_FOCUS_MIN_DISTANCE_M;
	let maximumDistanceM = CAMERA_MAX_DISTANCE_M;
	for (
		let iteration = 0;
		iteration < CAMERA_FRAMING_ITERATIONS_COUNT;
		iteration++
	) {
		const distanceM = (minimumDistanceM + maximumDistanceM) / 2;
		projectionCamera.position
			.copy(target)
			.addScaledVector(direction, distanceM);
		projectionCamera.lookAt(target);
		projectionCamera.updateMatrixWorld(true);
		let minimumEastPx = Number.POSITIVE_INFINITY;
		let maximumEastPx = Number.NEGATIVE_INFINITY;
		let minimumNorthPx = Number.POSITIVE_INFINITY;
		let maximumNorthPx = Number.NEGATIVE_INFINITY;
		let behindCamera = false;
		for (const point of points) {
			projection.copy(point).applyMatrix4(projectionCamera.matrixWorldInverse);
			if (projection.z >= -camera.near) behindCamera = true;
			projection.copy(point).project(projectionCamera);
			const eastPx = (projection.x * viewport.width) / 2;
			const northPx = (projection.y * viewport.height) / 2;
			minimumEastPx = Math.min(minimumEastPx, eastPx);
			maximumEastPx = Math.max(maximumEastPx, eastPx);
			minimumNorthPx = Math.min(minimumNorthPx, northPx);
			maximumNorthPx = Math.max(maximumNorthPx, northPx);
		}
		const occupancy = Math.max(
			(maximumEastPx - minimumEastPx) / freeWidthPx,
			(maximumNorthPx - minimumNorthPx) / freeHeightPx,
		);
		if (behindCamera || occupancy > fillRatio) minimumDistanceM = distanceM;
		else maximumDistanceM = distanceM;
	}
	return {
		target,
		position: target.clone().addScaledVector(direction, maximumDistanceM),
	};
}
