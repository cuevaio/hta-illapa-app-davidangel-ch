import type { Bounds, Vec3 } from "../map/flight";
import {
	CREDIT_FLIGHT_DISTANCE_M,
	CREDIT_FLIGHT_MAX_ANGLE_RAD,
	CREDIT_FLIGHT_MAX_DISTANCE_M,
	CREDIT_FLIGHT_PITCH_RAD,
	CREDIT_TABLE_LIFT_M,
	CREDIT_TABLE_MARGIN_M,
	CREDIT_TABLE_MAX_SCALE,
	CREDIT_TABLE_MIN_SCALE,
	CREDIT_TABLE_TILT_RAD,
} from "./constants";
import { tableScale } from "./mapTable";
import { heading, type MaquettePose, rotY } from "./placement";

/** A credit label pose: centre, heading it faces the user along, tilt back (rad) and size factor. */
export interface CreditPose {
	position: Vec3;
	yaw: number;
	tilt: number;
	scale: number;
}

/**
 * The VR map credit (S16): the imagery attribution while Satélite is on (with the keyless
 * prototype notice on the same line) and the weather attribution while a layer is on.
 */
export function vrCreditContent(
	imagery: { text: string; notice: string | null } | null,
	weather: string | null,
): { text: string; notice: boolean } | null {
	const lines = [
		imagery
			? imagery.notice
				? `${imagery.text} · ${imagery.notice}`
				: imagery.text
			: null,
		weather,
	].filter((line): line is string => Boolean(line));
	if (!lines.length) return null;
	return { text: lines.join("\n"), notice: Boolean(imagery?.notice) };
}

/** Maquette: on the table's near (south) edge, tilted up toward the user, sized with the table. */
export function tableCreditPose(b: Bounds, pose: MaquettePose): CreditPose {
	const halfDepth = ((b.maxZ - b.minZ) / 2) * pose.scale;
	const [x, z] = rotY([0, -halfDepth - CREDIT_TABLE_MARGIN_M], pose.yaw);
	return {
		position: [
			pose.center[0] + x,
			pose.center[1] + CREDIT_TABLE_LIFT_M,
			pose.center[2] + z,
		],
		yaw: pose.yaw,
		tilt: CREDIT_TABLE_TILT_RAD,
		scale: Math.min(
			Math.max(pose.scale / tableScale(b), CREDIT_TABLE_MIN_SCALE),
			CREDIT_TABLE_MAX_SCALE,
		),
	};
}

/** Flight: below the gaze heading, out of the central view, facing the head. */
export function flightCreditPose(head: Vec3, gaze: Vec3): CreditPose {
	const yaw =
		Math.hypot(gaze[0], gaze[2]) > 1e-6 ? heading(gaze[0], gaze[2]) : 0;
	const across = Math.cos(CREDIT_FLIGHT_PITCH_RAD) * CREDIT_FLIGHT_DISTANCE_M;
	return {
		position: [
			head[0] + Math.sin(yaw) * across,
			head[1] - Math.sin(CREDIT_FLIGHT_PITCH_RAD) * CREDIT_FLIGHT_DISTANCE_M,
			head[2] + Math.cos(yaw) * across,
		],
		yaw,
		tilt: CREDIT_FLIGHT_PITCH_RAD,
		scale: 1,
	};
}

/** Whether the world-stable flight credit left the view (or the user flew away from it). */
export function creditOutOfView(
	head: Vec3,
	gaze: Vec3,
	position: Vec3,
): boolean {
	const toCredit: Vec3 = [
		position[0] - head[0],
		position[1] - head[1],
		position[2] - head[2],
	];
	const distance = Math.hypot(...toCredit);
	if (distance > CREDIT_FLIGHT_MAX_DISTANCE_M) return true;
	const cosine =
		(toCredit[0] * gaze[0] + toCredit[1] * gaze[1] + toCredit[2] * gaze[2]) /
		(distance * Math.hypot(...gaze));
	return (
		Math.acos(Math.min(1, Math.max(-1, cosine))) > CREDIT_FLIGHT_MAX_ANGLE_RAD
	);
}
