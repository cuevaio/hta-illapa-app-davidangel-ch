import { describe, expect, it } from "vitest";
import {
	immersivePlacement,
	maquettePlacement,
	RaySmoother,
	snapPoint,
} from "../src/xr/placement";

describe("maquettePlacement", () => {
	it("scales the terrain to the table and centres it on the table top", () => {
		const p = maquettePlacement(
			{ size: 2000, minHeight: 100, maxHeight: 600 },
			{ tableSize: 1.2, center: [0, 0.8, 1] },
		);
		expect(p.scale).toBeCloseTo(1.2 / 2000, 12);
		// Grid centre (1000, minHeight, 1000) lands on the table centre; the lowest point sits on the top.
		expect(1000 * p.scale + p.position[0]).toBeCloseTo(0, 9);
		expect(100 * p.scale + p.position[1]).toBeCloseTo(0.8, 9);
		expect(1000 * p.scale + p.position[2]).toBeCloseTo(1, 9);
	});
});

describe("immersivePlacement", () => {
	it("puts the chosen terrain point under the user at floor level", () => {
		const p = immersivePlacement([400, 900], 250);
		expect(p.scale).toBe(1);
		expect(p.position).toEqual([-400, -250, -900]);
	});
});

describe("snapPoint", () => {
	it("snaps terrain-local points to the grid step, and is a no-op for step 0", () => {
		expect(snapPoint([12.4, 37.6], 10)).toEqual([10, 40]);
		expect(snapPoint([12.4, 37.6], 0)).toEqual([12.4, 37.6]);
	});
});

describe("RaySmoother", () => {
	it("passes the first ray through and low-pass filters the direction afterwards", () => {
		const s = new RaySmoother();
		const a = s.next({ origin: [0, 0, 0], direction: [1, 0, 0] }, 0.5);
		expect(a.direction).toEqual([1, 0, 0]);
		const b = s.next({ origin: [1, 2, 3], direction: [0, 1, 0] }, 0.5);
		expect(b.origin).toEqual([1, 2, 3]);
		expect(b.direction[0]).toBeCloseTo(Math.SQRT1_2, 6);
		expect(b.direction[1]).toBeCloseTo(Math.SQRT1_2, 6);
		expect(Math.hypot(...b.direction)).toBeCloseTo(1, 9);
	});
	it("smoothing 0 follows the hand exactly", () => {
		const s = new RaySmoother();
		s.next({ origin: [0, 0, 0], direction: [1, 0, 0] }, 0);
		expect(
			s.next({ origin: [0, 0, 0], direction: [0, 0, 1] }, 0).direction,
		).toEqual([0, 0, 1]);
	});
});

import {
	grabOneHand,
	grabTwoHands,
	type MaquettePose,
	rootFromPose,
	rotY,
	snapTurn,
} from "../src/xr/placement";

const EXT = { size: 2000, minHeight: 100, maxHeight: 600 };
/** World position of a terrain-local point under a root placement (Babylon order: scale, rotate Y, translate). */
function toWorld(
	p: ReturnType<typeof rootFromPose>,
	local: [number, number, number],
): [number, number, number] {
	const [x, z] = rotY([local[0] * p.scale, local[2] * p.scale], p.yaw);
	return [
		p.position[0] + x,
		p.position[1] + local[1] * p.scale,
		p.position[2] + z,
	];
}
const close3 = (a: number[], b: number[]) =>
	a.forEach((v, k) => {
		expect(v).toBeCloseTo(b[k], 9);
	});

describe("maquette pose", () => {
	const pose: MaquettePose = {
		center: [0, 0.85, 0.9],
		yaw: 0.7,
		scale: 1.2 / 2000,
	};

	it("puts the terrain centre at the pose centre for any yaw", () => {
		close3(toWorld(rootFromPose(EXT, pose), [1000, 100, 1000]), [0, 0.85, 0.9]);
	});

	it("one-hand grab: the terrain point held by the hand follows it, turning with the wrist", () => {
		const hand0: [number, number, number] = [0.3, 1.0, 0.7];
		const held = toWorld(rootFromPose(EXT, pose), [1500, 300, 400]);
		const now = grabOneHand(
			pose,
			{ hand: hand0, yaw: 0.2 },
			{ hand: [0.5, 1.1, 0.4], yaw: 0.2 + 0.5 },
		);
		expect(now.yaw).toBeCloseTo(pose.yaw + 0.5, 12);
		expect(now.scale).toBe(pose.scale);
		// The held point keeps its offset to the hand, rotated by the wrist turn.
		const offset0 = [
			held[0] - hand0[0],
			held[1] - hand0[1],
			held[2] - hand0[2],
		];
		const [ox, oz] = rotY([offset0[0], offset0[2]], 0.5);
		close3(toWorld(rootFromPose(EXT, now), [1500, 300, 400]), [
			0.5 + ox,
			1.1 + offset0[1],
			0.4 + oz,
		]);
	});

	it("two-hand grab: spreading the hands scales, turning them rotates about their midpoint", () => {
		const a0: [number, number, number] = [-0.2, 1, 0.8];
		const b0: [number, number, number] = [0.2, 1, 0.8];
		const now = grabTwoHands(
			pose,
			{ a: a0, b: b0 },
			{ a: [-0.4, 1, 0.8], b: [0.4, 1, 0.8] },
			{ min: 0, max: 1 },
		);
		expect(now.scale).toBeCloseTo(pose.scale * 2, 12);
		expect(now.yaw).toBeCloseTo(pose.yaw, 12);
		// Midpoint unchanged, so the centre moves away from it by the same factor.
		close3(now.center, [0, 0.85 + (0.85 - 1) * 1, 0.9 + (0.9 - 0.8) * 1]);
		const turned = grabTwoHands(
			pose,
			{ a: a0, b: b0 },
			{ a: [0, 1, 0.6], b: [0, 1, 1.0] },
			{ min: 0, max: 1 },
		);
		expect(turned.yaw - pose.yaw).toBeCloseTo(-Math.PI / 2, 9);
	});

	it("two-hand scale is clamped", () => {
		const now = grabTwoHands(
			pose,
			{ a: [-0.1, 1, 0], b: [0.1, 1, 0] },
			{ a: [-1, 1, 0], b: [1, 1, 0] },
			{ min: 0, max: pose.scale * 3 },
		);
		expect(now.scale).toBeCloseTo(pose.scale * 3, 12);
	});

	it("snap turn rotates about the centre", () => {
		const now = snapTurn(pose, Math.PI / 6);
		expect(now.yaw).toBeCloseTo(pose.yaw + Math.PI / 6, 12);
		expect(now.center).toEqual(pose.center);
	});
});

import { panelInFront } from "../src/xr/placement";

describe("panelInFront", () => {
	it("places the panel ahead of the head along its horizontal heading, slightly below eye level", () => {
		const p = panelInFront([1, 1.6, 2], [0, -0.5, 1]); // looking forward (+z) and a bit down
		close3(p.position, [1, 1.6 - 0.15, 2 + 0.6]);
		expect(p.yaw).toBeCloseTo(0, 12);
	});
	it("follows the heading when turned", () => {
		const p = panelInFront([0, 1.7, 0], [1, 0, 0]); // looking along +x
		close3(p.position, [0.6, 1.55, 0]);
		expect(p.yaw).toBeCloseTo(Math.PI / 2, 12);
	});
});
