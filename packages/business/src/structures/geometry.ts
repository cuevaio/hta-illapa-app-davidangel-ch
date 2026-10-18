import { METERS_PER_KM } from "../constants";
import {
	BYPASS_SHOULDER_WIDTH_M,
	PERCENT_SCALE_RATIO,
	STRUCTURE_LENGTH_FRACTION_DIGITS,
} from "./constants";

interface StructurePoint {
	x: number;
	y: number;
	z: number;
}

export interface StructureGeometry {
	kind: "bridge" | "tunnel" | "bypass" | "entity";
	start?: StructurePoint;
	end?: StructurePoint;
	points?: StructurePoint[];
}

export function structureLengthM(template: StructureGeometry): number {
	const points =
		template.kind === "bypass"
			? (template.points ?? [])
			: template.start && template.end
				? [template.start, template.end]
				: [];
	let lengthM = 0;
	for (const [index, point] of points.entries()) {
		const previous = points[index - 1];
		if (previous)
			lengthM += Math.hypot(
				point.x - previous.x,
				point.y - previous.y,
				point.z - previous.z,
			);
	}
	return lengthM;
}

export function formatStructureLength(lengthM: number, locale: string): string {
	const formatter = new Intl.NumberFormat(locale, {
		minimumFractionDigits: STRUCTURE_LENGTH_FRACTION_DIGITS,
		maximumFractionDigits: STRUCTURE_LENGTH_FRACTION_DIGITS,
	});
	return lengthM >= METERS_PER_KM
		? `${formatter.format(lengthM / METERS_PER_KM)} km`
		: `${formatter.format(lengthM)} m`;
}

export function structureGradePercent(template: StructureGeometry): number {
	if (!template.start || !template.end) return 0;
	const horizontalM = Math.hypot(
		template.end.x - template.start.x,
		template.end.z - template.start.z,
	);
	return horizontalM
		? (Math.abs(template.end.y - template.start.y) / horizontalM) *
				PERCENT_SCALE_RATIO
		: 0;
}

export function bypassWidthM(template: {
	laneCount: number;
	laneWidthM: number;
}): number {
	return template.laneCount * template.laneWidthM + BYPASS_SHOULDER_WIDTH_M * 2;
}
