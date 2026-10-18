import { describe, expect, it } from "vitest";
import type { Vec3 } from "../src/map/flight";
import {
	fromTableLocal,
	leaderStart,
	placePointCard,
	toTableLocal,
} from "../src/xr/cardPlacement";
import {
	CARD_MAX_DISTANCE_M,
	CARD_MIN_DISTANCE_M,
	CARD_READING_DISTANCE_M,
} from "../src/xr/constants";

const HEAD: Vec3 = [0, 1.6, 0];
const NORTH: Vec3 = [0, 0, 1];
const CARD = { width: 0.4, height: 0.43 };
/** "No inmediatamente cerca": the card centre stays this far from the marked point (m). */
const NOT_RIGHT_NEXT_TO_M = 0.25;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (v: Vec3) => Math.hypot(...v);

/** Does the head → marker segment cross the level card rectangle that faces the head? */
function blocksView(card: Vec3, marker: Vec3): boolean {
	const toCard = sub(card, HEAD);
	const normalLength = Math.hypot(toCard[0], toCard[2]);
	const normal: Vec3 = [toCard[0] / normalLength, 0, toCard[2] / normalLength];
	const right: Vec3 = [normal[2], 0, -normal[0]];
	const ray = sub(marker, HEAD);
	const along = ray[0] * normal[0] + ray[2] * normal[2];
	if (along <= 0) return false;
	const t = (toCard[0] * normal[0] + toCard[2] * normal[2]) / along;
	if (t < 0 || t > 1) return false;
	const hit = sub(
		[HEAD[0] + ray[0] * t, HEAD[1] + ray[1] * t, HEAD[2] + ray[2] * t],
		card,
	);
	return (
		Math.abs(hit[0] * right[0] + hit[2] * right[2]) <= CARD.width / 2 &&
		Math.abs(hit[1]) <= CARD.height / 2
	);
}

const place = (
	marker: Vec3,
	view: "vuelo" | "maqueta" = "vuelo",
	gaze = NORTH,
) => placePointCard({ marker, head: HEAD, gaze, view, cardSize: CARD });

describe("placePointCard (S13): the VR point card beside the marked point", () => {
	it("goes to the side with more room in the view: left of a point on the right, and back", () => {
		const onTheRight = place([2, 0.4, 5]);
		expect(onTheRight.side).toBe("left");
		expect(onTheRight.position[0]).toBeLessThan(
			2 * (onTheRight.position[2] / 5),
		);
		const onTheLeft = place([-2, 0.4, 5]);
		expect(onTheLeft.side).toBe("right");
		expect(onTheLeft.position[0]).toBeGreaterThan(
			-2 * (onTheLeft.position[2] / 5),
		);
	});

	it("follows the user's view, not the map axes", () => {
		const facingEast = place([5, 0.4, -2], "vuelo", [1, 0, 0]);
		expect(facingEast.side).toBe("left");
		expect(facingEast.position[2]).toBeGreaterThan(
			-2 * (facingEast.position[0] / 5),
		);
	});

	it("never sits right next to the marker, wherever the marker is", () => {
		for (const marker of [
			[0, 0.2, 0.4],
			[0.3, 1.0, 0.75],
			[1, -3, 4],
			[-6, 1.6, 30],
			[0, 1.2, 1.1],
		] satisfies Vec3[])
			for (const view of ["vuelo", "maqueta"] as const)
				expect(
					length(sub(place(marker, view).position, marker)),
				).toBeGreaterThanOrEqual(NOT_RIGHT_NEXT_TO_M);
	});

	it("never blocks the line of sight to the marker", () => {
		for (const marker of [
			[0, 1.6, 3],
			[0.1, 1.05, 0.7],
			[2, -1, 8],
			[-0.2, 1.7, 0.9],
			[0, 0, 0.2],
		] satisfies Vec3[])
			for (const view of ["vuelo", "maqueta"] as const)
				expect(blocksView(place(marker, view).position, marker)).toBe(false);
	});

	it("flight: a reading distance from the head however far the point is", () => {
		for (const marker of [
			[0, 0, 3],
			[4, -2, 40],
		] satisfies Vec3[])
			expect(length(sub(place(marker).position, HEAD))).toBeCloseTo(
				CARD_READING_DISTANCE_M,
				6,
			);
		expect(length(sub(place([0, 1.5, 0.2]).position, HEAD))).toBeCloseTo(
			CARD_MIN_DISTANCE_M,
			6,
		);
	});

	it("maquette: at the depth of the point on the table, so a bigger table moves it out too", () => {
		const fitted = place([0.1, 1.05, 0.9], "maqueta");
		const scaledUp = place([0.1, 1.05, 1.1], "maqueta");
		expect(length(sub(fitted.position, HEAD))).toBeCloseTo(
			length(sub([0.1, 1.05, 0.9], HEAD)),
			6,
		);
		expect(length(sub(scaledUp.position, HEAD))).toBeGreaterThan(
			length(sub(fitted.position, HEAD)),
		);
		expect(
			length(sub(place([0, 0.5, 6], "maqueta").position, HEAD)),
		).toBeCloseTo(CARD_MAX_DISTANCE_M, 6);
	});

	it("stays above the table: a point far below the eyes lifts the card toward eye level", () => {
		const card = place([0.1, 1.05, 0.6], "maqueta");
		expect(card.position[1]).toBeGreaterThan(1.05);
		expect(card.position[1]).toBeLessThan(HEAD[1]);
	});
});

describe("leaderStart: the hairline leaves from the card edge facing the marker", () => {
	it("starts on the marker's side, half a card width from its centre", () => {
		const card: Vec3 = [-0.3, 1.5, 0.7];
		const start = leaderStart(card, HEAD, [0.4, 1.0, 1.2], CARD.width);
		expect(start[0]).toBeGreaterThan(card[0]);
		expect(length(sub(start, card))).toBeCloseTo(CARD.width / 2, 6);
		const other = leaderStart(card, HEAD, [-1.4, 1.0, 1.2], CARD.width);
		expect(other[0]).toBeLessThan(card[0]);
	});
});

describe("table-local marker: the leader follows the point when the table moves", () => {
	it("round-trips through the table pose (centre, yaw, scale)", () => {
		const pose = {
			center: [0.2, 0.9, 0.8] satisfies Vec3,
			yaw: 0.7,
			scale: 0.002,
		};
		const world: Vec3 = [0.5, 0.95, 1.1];
		const local = toTableLocal(world, pose);
		const back = fromTableLocal(local, pose);
		for (const axis of [0, 1, 2])
			expect(back[axis]).toBeCloseTo(world[axis], 9);
		const moved = fromTableLocal(local, { ...pose, center: [1.2, 0.9, 0.8] });
		expect(moved[0]).toBeCloseTo(world[0] + 1, 9);
	});
});
