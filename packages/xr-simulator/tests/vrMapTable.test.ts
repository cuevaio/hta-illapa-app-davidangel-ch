import { describe, expect, it } from "vitest";
import type { Bounds } from "../src/map/flight";
import {
	MAP_TABLE,
	mapRootFromPose,
	mapToWorld,
	TableGrab,
	tableInFront,
	tableScale,
	tableScaleLimits,
} from "../src/xr/mapTable";

// Peru-like local bounds (km): ~1700 km east-west, ~2300 km north-south, origin near the centre.
const PERU: Bounds = { minX: -850, maxX: 850, minZ: -1200, maxZ: 1100 };
const CX = 0;
const CZ = -50;

describe("map maquette fit (Peru on a table)", () => {
	it("fits the longest side of Peru to the table width", () => {
		const s = tableScale(PERU);
		expect(s).toBeCloseTo(MAP_TABLE.width / 2300, 12);
		expect(MAP_TABLE.width).toBeGreaterThanOrEqual(1);
		expect(MAP_TABLE.width).toBeLessThanOrEqual(1.5);
		expect(tableScale(PERU, 2)).toBeCloseTo(2 / 2300, 12);
	});

	it("puts the table in front of the head, below eye level, north pointing away from the user", () => {
		const pose = tableInFront([1, 1.6, 2], Math.PI / 2, PERU);
		expect(pose.center[0]).toBeCloseTo(1 + MAP_TABLE.distance, 9);
		expect(pose.center[2]).toBeCloseTo(2, 9);
		expect(pose.center[1]).toBeCloseTo(1.6 - MAP_TABLE.drop, 9);
		expect(pose.yaw).toBeCloseTo(Math.PI / 2, 9);
		// Seated or low head: the table never sinks below a minimum height.
		expect(tableInFront([0, 0.5, 0], 0, PERU).center[1]).toBe(
			MAP_TABLE.minHeight,
		);
	});

	it("maps the centre of Peru at sea level to the table centre and north away from the user", () => {
		const pose = tableInFront([0, 1.6, 0], 0, PERU);
		const root = mapRootFromPose(PERU, pose);
		const c = mapToWorld(root, [CX, 0, CZ]);
		expect(c[0]).toBeCloseTo(pose.center[0], 9);
		expect(c[1]).toBeCloseTo(pose.center[1], 9);
		expect(c[2]).toBeCloseTo(pose.center[2], 9);
		// North edge: farther from the user (+z, the gaze) by half the depth at table scale.
		const n = mapToWorld(root, [CX, 0, PERU.maxZ]);
		expect(n[2] - c[2]).toBeCloseTo((PERU.maxZ - CZ) * root.scaling[0], 9);
		// Relief is exaggerated on the table: 1 km of (already exaggerated) relief rises boost × scale.
		const top = mapToWorld(root, [CX, 1, CZ]);
		expect(top[1] - c[1]).toBeCloseTo(
			root.scaling[0] * MAP_TABLE.reliefBoost,
			12,
		);
	});

	it("turns with the pose yaw (Babylon RotationY convention)", () => {
		const pose = {
			center: [0, 1, 0] as [number, number, number],
			yaw: Math.PI / 2,
			scale: 0.001,
		};
		const root = mapRootFromPose(PERU, pose);
		// North (+z local) now points to +x in the world.
		const n = mapToWorld(root, [CX, 0, CZ + 100]);
		expect(n[0]).toBeCloseTo(0.1, 9);
		expect(n[2]).toBeCloseTo(0, 9);
	});

	it("limits the two-hand scale to a table between the min and max widths", () => {
		const l = tableScaleLimits(PERU);
		expect(l.min * 2300).toBeCloseTo(MAP_TABLE.minWidth, 9);
		expect(l.max * 2300).toBeCloseTo(MAP_TABLE.maxWidth, 9);
	});
});

describe("TableGrab (map maquette manipulation)", () => {
	const pose = {
		center: [0, 1, 1] as [number, number, number],
		yaw: 0,
		scale: 0.001,
	};
	const limits = { min: 0.0001, max: 0.01 };

	it("one grip moves the table with the hand and turns it with the wrist", () => {
		const g = new TableGrab();
		expect(
			g.step(pose, [{ id: "r", position: [0.2, 1, 0.5], yaw: 0 }], limits),
		).toEqual(pose);
		const moved = g.step(
			pose,
			[{ id: "r", position: [0.3, 1.1, 0.5], yaw: 0 }],
			limits,
		);
		expect(moved.center[0]).toBeCloseTo(0.1, 9);
		expect(moved.center[1]).toBeCloseTo(1.1, 9);
		expect(moved.center[2]).toBeCloseTo(1, 9);
		const turned = g.step(
			pose,
			[{ id: "r", position: [0.2, 1, 0.5], yaw: 0.3 }],
			limits,
		);
		expect(turned.yaw).toBeCloseTo(0.3, 9);
		expect(turned.scale).toBe(pose.scale);
	});

	it("two grips scale the table; switching hands never jumps", () => {
		const g = new TableGrab();
		g.step(pose, [{ id: "r", position: [0.1, 1, 1], yaw: 0 }], limits);
		const a = {
			id: "l",
			position: [-0.1, 1, 1] as [number, number, number],
			yaw: 0,
		};
		// The frame the second hand joins returns the current pose unchanged.
		const p0 = g.step(
			pose,
			[{ id: "r", position: [0.1, 1, 1], yaw: 0 }, a],
			limits,
		);
		expect(p0).toEqual(pose);
		const p1 = g.step(
			p0,
			[
				{ id: "r", position: [0.3, 1, 1], yaw: 0 },
				{ ...a, position: [-0.3, 1, 1] },
			],
			limits,
		);
		expect(p1.scale).toBeCloseTo(0.003, 9);
		const p2 = g.step(
			p0,
			[
				{ id: "r", position: [3, 1, 1], yaw: 0 },
				{ ...a, position: [-3, 1, 1] },
			],
			limits,
		);
		expect(p2.scale).toBe(limits.max);
		// Releasing every grip ends the grab.
		expect(g.step(p2, [], limits)).toEqual(p2);
		expect(g.active).toBe(false);
	});
});
