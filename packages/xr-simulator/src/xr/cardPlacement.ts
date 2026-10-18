import type { Vec3 } from "../map/flight";
import {
	CARD_MARKER_GAP_M,
	CARD_MAX_DISTANCE_M,
	CARD_MAX_PITCH_RAD,
	CARD_MIN_DISTANCE_M,
	CARD_MIN_PITCH_RAD,
	CARD_READING_DISTANCE_M,
} from "./constants";
import { type MaquettePose, rotY } from "./placement";
import type { VrView } from "./vrMode";

export interface PointCardPlacement {
	marker: Vec3;
	head: Vec3;
	gaze: Vec3;
	view: VrView;
	/** The card mesh in metres. */
	cardSize: { width: number; height: number };
}

export interface PointCardPose {
	/** Card centre; the card itself turns about the vertical to face the user. */
	position: Vec3;
	side: "left" | "right";
}

const horizontal = (v: Vec3): [number, number] | null => {
	const length = Math.hypot(v[0], v[2]);
	return length > 1e-9 ? [v[0] / length, v[2] / length] : null;
};

/**
 * The VR point card (S13) beside the marked point, never over it: turned away from the head →
 * marker line toward the side with more room in the view (the side of the gaze opposite the
 * marker) by enough for its edge to clear that line by CARD_MARKER_GAP_M, at its elevation
 * within the pitch limits. Flight: at reading distance (the point can be kilometres away);
 * maquette: at the point's depth on the table.
 */
export function placePointCard({
	marker,
	head,
	gaze,
	view,
	cardSize,
}: PointCardPlacement): PointCardPose {
	const toMarker: Vec3 = [
		marker[0] - head[0],
		marker[1] - head[1],
		marker[2] - head[2],
	];
	const gazeDirection = horizontal(gaze) ?? [0, 1];
	const markerDirection = horizontal(toMarker) ?? gazeDirection;
	const gazeRight: [number, number] = [gazeDirection[1], -gazeDirection[0]];
	const markerOnTheRight =
		markerDirection[0] * gazeRight[0] + markerDirection[1] * gazeRight[1] > 0;
	const distance = Math.min(
		Math.max(Math.hypot(...toMarker), CARD_MIN_DISTANCE_M),
		view === "maqueta" ? CARD_MAX_DISTANCE_M : CARD_READING_DISTANCE_M,
	);
	const pitch = Math.min(
		Math.max(
			Math.atan2(toMarker[1], Math.hypot(toMarker[0], toMarker[2])),
			CARD_MIN_PITCH_RAD,
		),
		CARD_MAX_PITCH_RAD,
	);
	const horizontalDistance = distance * Math.cos(pitch);
	const turn = Math.atan2(
		cardSize.width / 2 + CARD_MARKER_GAP_M,
		horizontalDistance,
	);
	const [x, z] = rotY(markerDirection, markerOnTheRight ? -turn : turn);
	return {
		position: [
			head[0] + x * horizontalDistance,
			head[1] + distance * Math.sin(pitch),
			head[2] + z * horizontalDistance,
		],
		side: markerOnTheRight ? "left" : "right",
	};
}

/** Where the leader line leaves the card: the middle of its vertical edge facing the marker. */
export function leaderStart(
	card: Vec3,
	head: Vec3,
	marker: Vec3,
	cardWidth: number,
): Vec3 {
	const [facingX, facingZ] = horizontal([
		card[0] - head[0],
		0,
		card[2] - head[2],
	]) ?? [0, 1];
	const right: [number, number] = [facingZ, -facingX];
	const towardMarker =
		(marker[0] - card[0]) * right[0] + (marker[2] - card[2]) * right[1] >= 0
			? 1
			: -1;
	const half = (cardWidth / 2) * towardMarker;
	return [card[0] + right[0] * half, card[1], card[2] + right[1] * half];
}

/** A world point in the table's frame, so it can follow the table when it is moved. */
export function toTableLocal(world: Vec3, pose: MaquettePose): Vec3 {
	const [x, z] = rotY(
		[world[0] - pose.center[0], world[2] - pose.center[2]],
		-pose.yaw,
	);
	return [
		x / pose.scale,
		(world[1] - pose.center[1]) / pose.scale,
		z / pose.scale,
	];
}

export function fromTableLocal(local: Vec3, pose: MaquettePose): Vec3 {
	const [x, z] = rotY([local[0] * pose.scale, local[2] * pose.scale], pose.yaw);
	return [
		pose.center[0] + x,
		pose.center[1] + local[1] * pose.scale,
		pose.center[2] + z,
	];
}
