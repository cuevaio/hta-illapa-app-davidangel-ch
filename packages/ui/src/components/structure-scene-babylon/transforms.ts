import { Quaternion } from "@babylonjs/core";
import type { StructurePoint } from "../../lib/structure-scene";
import {
	DEGREES_PER_RADIAN,
	EULER_SINGULARITY_RATIO,
	HALF_RATIO,
} from "./constants";

export function elementRotation(rotationDeg: StructurePoint): Quaternion {
	const halfX = (rotationDeg.x / DEGREES_PER_RADIAN) * HALF_RATIO;
	const halfY = (rotationDeg.y / DEGREES_PER_RADIAN) * HALF_RATIO;
	const halfZ = (rotationDeg.z / DEGREES_PER_RADIAN) * HALF_RATIO;
	const cosineX = Math.cos(halfX);
	const cosineY = Math.cos(halfY);
	const cosineZ = Math.cos(halfZ);
	const sineX = Math.sin(halfX);
	const sineY = Math.sin(halfY);
	const sineZ = Math.sin(halfZ);
	return new Quaternion(
		sineX * cosineY * cosineZ + cosineX * sineY * sineZ,
		cosineX * sineY * cosineZ - sineX * cosineY * sineZ,
		cosineX * cosineY * sineZ + sineX * sineY * cosineZ,
		cosineX * cosineY * cosineZ - sineX * sineY * sineZ,
	);
}

export function elementRotationDegrees(rotation: Quaternion): StructurePoint {
	const horizontal = 2 * (rotation.x * rotation.z + rotation.w * rotation.y);
	return {
		x:
			(Math.abs(horizontal) < EULER_SINGULARITY_RATIO
				? Math.atan2(
						2 * (rotation.w * rotation.x - rotation.y * rotation.z),
						1 - 2 * (rotation.x * rotation.x + rotation.y * rotation.y),
					)
				: Math.atan2(
						2 * (rotation.y * rotation.z + rotation.w * rotation.x),
						1 - 2 * (rotation.x * rotation.x + rotation.z * rotation.z),
					)) * DEGREES_PER_RADIAN,
		y: Math.asin(Math.max(-1, Math.min(1, horizontal))) * DEGREES_PER_RADIAN,
		z:
			(Math.abs(horizontal) < EULER_SINGULARITY_RATIO
				? Math.atan2(
						2 * (rotation.w * rotation.z - rotation.x * rotation.y),
						1 - 2 * (rotation.y * rotation.y + rotation.z * rotation.z),
					)
				: 0) * DEGREES_PER_RADIAN,
	};
}
