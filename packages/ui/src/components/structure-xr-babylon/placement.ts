import type { LocalPoint } from "@hack-the-andes-project/terrain/types";
import {
	MAQUETA_SCALE_RATIO,
	PLACEMENT_FALLBACK_DISTANCE_M,
	PLACEMENT_FALLBACK_HEIGHT_M,
} from "./constants";

export interface XrPoint extends LocalPoint {
	y: number;
}

export function getMaquetaOffset(
	focus: LocalPoint,
	baseElevationM: number,
): XrPoint {
	return {
		x: -focus.x * MAQUETA_SCALE_RATIO,
		y: -baseElevationM * MAQUETA_SCALE_RATIO,
		z: -focus.z * MAQUETA_SCALE_RATIO,
	};
}

export function getFallbackTablePosition(
	viewer: XrPoint,
	forward: XrPoint,
): XrPoint {
	const horizontalLength = Math.hypot(forward.x, forward.z);
	return {
		x:
			viewer.x +
			(horizontalLength ? forward.x / horizontalLength : 0) *
				PLACEMENT_FALLBACK_DISTANCE_M,
		y: PLACEMENT_FALLBACK_HEIGHT_M,
		z:
			viewer.z +
			(horizontalLength ? forward.z / horizontalLength : -1) *
				PLACEMENT_FALLBACK_DISTANCE_M,
	};
}
