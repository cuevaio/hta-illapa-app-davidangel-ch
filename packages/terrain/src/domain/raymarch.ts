import {
	RAY_BISECTION_ITERATIONS_COUNT,
	RAY_MAX_STEPS_COUNT,
	RAY_MIN_STEP_M,
	RAY_STEP_FACTOR_RATIO,
} from "../constants";
import type { Vec3 } from "./types";

export interface RaymarchOptions {
	readonly maxDistance: number;
	readonly minStep?: number;
	readonly stepFactor?: number;
	readonly maxSteps?: number;
}

export function intersectHeightfield(
	origin: Vec3,
	direction: Vec3,
	heightAt: (x: number, z: number) => number | null,
	options: RaymarchOptions,
): Vec3 | null {
	const minStep = options.minStep ?? RAY_MIN_STEP_M;
	const stepFactor = options.stepFactor ?? RAY_STEP_FACTOR_RATIO;
	const maxSteps = options.maxSteps ?? RAY_MAX_STEPS_COUNT;
	const pointAt = (distance: number) => ({
		x: origin.x + direction.x * distance,
		y: origin.y + direction.y * distance,
		z: origin.z + direction.z * distance,
	});
	const clearance = (distance: number) => {
		const point = pointAt(distance);
		const elevation = heightAt(point.x, point.z);
		return elevation === null ? null : point.y - elevation;
	};
	let previousDistance = 0;
	let previousClearance = clearance(0);
	if (previousClearance === null) return null;
	if (previousClearance <= 0) return pointAt(0);
	for (
		let stepIndex = 0;
		stepIndex < maxSteps && previousDistance < options.maxDistance;
		stepIndex++
	) {
		const distance = Math.min(
			options.maxDistance,
			previousDistance + Math.max(minStep, previousClearance * stepFactor),
		);
		const currentClearance = clearance(distance);
		if (currentClearance === null) return null;
		if (currentClearance <= 0) {
			let lowerDistance = previousDistance;
			let upperDistance = distance;
			for (
				let iteration = 0;
				iteration < RAY_BISECTION_ITERATIONS_COUNT;
				iteration++
			) {
				const middleDistance = (lowerDistance + upperDistance) / 2;
				const middleClearance = clearance(middleDistance);
				if (middleClearance === null) return null;
				if (middleClearance > 0) lowerDistance = middleDistance;
				else upperDistance = middleDistance;
			}
			return pointAt(upperDistance);
		}
		previousDistance = distance;
		previousClearance = currentClearance;
	}
	return null;
}
