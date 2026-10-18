import type { Vec3 } from "../map/flight";
import {
	INSTRUCTIONS_DISTANCE_M,
	INSTRUCTIONS_DROP_M,
	INSTRUCTIONS_SIDE_ANGLE_RAD,
} from "./constants";
import { heading } from "./placement";

/**
 * The VR controls card (S15): shown on entering VR until «Entendido» dismisses it; after that it
 * stays hidden on later entries in the same page and only «Controles» in the menus reopens it.
 */
export interface InstructionsState {
	shown: boolean;
	dismissed: boolean;
}

export type InstructionsEvent = "enter" | "dismiss" | "reopen" | "exit";

export const INSTRUCTIONS_START: InstructionsState = {
	shown: false,
	dismissed: false,
};

export function instructionsStep(
	state: InstructionsState,
	event: InstructionsEvent,
): InstructionsState {
	if (event === "enter") return { ...state, shown: !state.dismissed };
	if (event === "reopen") return { ...state, shown: true };
	if (event === "dismiss") return { shown: false, dismissed: true };
	return { ...state, shown: false };
}

/**
 * Where the card spawns and then stays: at reading distance, turned right of the gaze heading so
 * it is out of the central line of sight, below eye level, level and facing the user.
 */
export function instructionsPose(
	head: Vec3,
	gaze: Vec3,
	sideAngle: number = INSTRUCTIONS_SIDE_ANGLE_RAD,
): { position: Vec3; yaw: number } {
	const level = Math.hypot(gaze[0], gaze[2]) > 1e-6;
	const yaw = (level ? heading(gaze[0], gaze[2]) : 0) + sideAngle;
	return {
		position: [
			head[0] + Math.sin(yaw) * INSTRUCTIONS_DISTANCE_M,
			head[1] - INSTRUCTIONS_DROP_M,
			head[2] + Math.cos(yaw) * INSTRUCTIONS_DISTANCE_M,
		],
		yaw,
	};
}
