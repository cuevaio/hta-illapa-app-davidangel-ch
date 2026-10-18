import { describe, expect, it } from "vitest";
import type { Vec3 } from "../src/map/flight";
import { panelFooter } from "../src/ui/sections";
import {
	INSTRUCTIONS_BESIDE_PANEL_ANGLE_RAD,
	INSTRUCTIONS_DISTANCE_M,
	INSTRUCTIONS_SIDE_ANGLE_RAD,
} from "../src/xr/constants";
import {
	INSTRUCTIONS_START,
	instructionsPose,
	instructionsStep,
} from "../src/xr/instructions";

describe("instructionsStep (S15): the VR controls card", () => {
	it("shows on the first entry and hides when dismissed with «Entendido»", () => {
		const entered = instructionsStep(INSTRUCTIONS_START, "enter");
		expect(entered.shown).toBe(true);
		const dismissed = instructionsStep(entered, "dismiss");
		expect(dismissed).toEqual({ shown: false, dismissed: true });
	});

	it("stays hidden on later entries once dismissed, also after leaving VR", () => {
		let state = instructionsStep(INSTRUCTIONS_START, "enter");
		state = instructionsStep(state, "dismiss");
		state = instructionsStep(state, "exit");
		state = instructionsStep(state, "enter");
		expect(state.shown).toBe(false);
	});

	it("shows again on every entry while it was never dismissed", () => {
		let state = instructionsStep(INSTRUCTIONS_START, "enter");
		state = instructionsStep(state, "exit");
		expect(state.shown).toBe(false);
		expect(instructionsStep(state, "enter").shown).toBe(true);
	});

	it("«Controles» in the menus reopens it, and dismissing hides it again", () => {
		let state = instructionsStep(INSTRUCTIONS_START, "enter");
		state = instructionsStep(state, "dismiss");
		state = instructionsStep(state, "reopen");
		expect(state).toEqual({ shown: true, dismissed: true });
		expect(instructionsStep(state, "dismiss").shown).toBe(false);
	});
});

describe("instructionsPose: where the card spawns", () => {
	const head: Vec3 = [1, 1.6, -2];
	const angleFromGaze = (position: Vec3, gaze: [number, number]) => {
		const x = position[0] - head[0];
		const z = position[2] - head[2];
		return Math.acos((x * gaze[0] + z * gaze[1]) / Math.hypot(x, z));
	};

	it("is at the reading distance, out of the central line of sight", () => {
		const pose = instructionsPose(head, [0, -0.3, 1]);
		const x = pose.position[0] - head[0];
		const z = pose.position[2] - head[2];
		expect(Math.hypot(x, z)).toBeCloseTo(INSTRUCTIONS_DISTANCE_M, 6);
		expect(angleFromGaze(pose.position, [0, 1])).toBeCloseTo(
			INSTRUCTIONS_SIDE_ANGLE_RAD,
			6,
		);
	});

	it("follows the gaze heading only (level), and faces the user", () => {
		const looking = instructionsPose(head, [1, 0.8, 0]);
		expect(angleFromGaze(looking.position, [1, 0])).toBeCloseTo(
			INSTRUCTIONS_SIDE_ANGLE_RAD,
			6,
		);
		const x = looking.position[0] - head[0];
		const z = looking.position[2] - head[2];
		expect(looking.yaw).toBeCloseTo(Math.atan2(x, z), 6);
		expect(looking.position[1]).toBeLessThan(head[1]);
		expect(instructionsPose(head, [0, -0.9, 1]).position[1]).toBeCloseTo(
			looking.position[1],
			9,
		);
	});
});

describe("instructionsPose beside the simulator panel", () => {
	it("turns far enough that the card clears the 0.5 m panel 0.6 m in front", () => {
		const head: Vec3 = [0, 1.6, 0];
		const pose = instructionsPose(
			head,
			[0, 0, 1],
			INSTRUCTIONS_BESIDE_PANEL_ANGLE_RAD,
		);
		const cardHalfAngle = Math.atan(0.45 / 2 / INSTRUCTIONS_DISTANCE_M);
		const panelHalfAngle = Math.atan(0.5 / 2 / 0.6);
		expect(
			Math.atan2(pose.position[0], pose.position[2]) - cardHalfAngle,
		).toBeGreaterThan(panelHalfAngle);
	});
});

describe("panelFooter: «Controles» reopens the instructions (S15)", () => {
	it("comes before «Salir de VR»", () => {
		expect(
			panelFooter({ backToMap: false, controls: true }).map((a) => a.text),
		).toEqual(["Controles", "Salir de VR"]);
	});
});
