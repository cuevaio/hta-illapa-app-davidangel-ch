import { NullEngine, Quaternion, Scene } from "@babylonjs/core";
import { MAX_STRUCTURE_EXTENT_M } from "@hack-the-andes-project/business/structures/constants";
import { createDefaultStructureTemplate } from "@hack-the-andes-project/business/structures/placement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clampPoint, createPlacement, snapHandlePoint } from "../placement";
import { elementRotation, elementRotationDegrees } from "../transforms";
import {
	TEST_ANCHOR_OFFSET_M,
	TEST_CURSOR_M,
	TEST_GROUND_M,
	TEST_SNAP_M,
	TEST_STRUCTURE,
	TEST_XYZ_ROTATIONS_DEG,
} from "./constants";
import { createTestTerrain } from "./terrain";

let engine: NullEngine;
let scene: Scene;
beforeEach(() => {
	engine = new NullEngine();
	scene = new Scene(engine);
	scene.useRightHandedSystem = true;
});
afterEach(() => engine.dispose());

describe("Babylon placement", () => {
	it("uses the business template factory", () => {
		const terrain = createTestTerrain(scene);
		const placed = createPlacement(terrain, TEST_CURSOR_M, { kind: "bridge" });
		expect(placed.template).toEqual(
			createDefaultStructureTemplate("bridge", TEST_CURSOR_M, terrain.heightAt),
		);
		expect(placed.anchor.elevationM).toBe(TEST_CURSOR_M.y);
	});
	it("snaps in the terrain origin frame before converting to an off-grid anchor", () => {
		const terrain = createTestTerrain(scene);
		const structure = {
			...TEST_STRUCTURE,
			anchor: {
				...terrain.toGeo(TEST_ANCHOR_OFFSET_M),
				elevationM: TEST_STRUCTURE.anchor.elevationM,
			},
		};
		const snapped = snapHandlePoint(terrain, structure, TEST_CURSOR_M);
		expect(snapped?.x).toBeCloseTo(TEST_SNAP_M.x - TEST_ANCHOR_OFFSET_M.x);
		expect(snapped?.z).toBeCloseTo(TEST_SNAP_M.z - TEST_ANCHOR_OFFSET_M.z);
		expect(snapped?.y).toBe(TEST_GROUND_M - structure.anchor.elevationM);
	});
	it("refuses a handle move onto missing terrain and clamps saved extents", () => {
		expect(
			snapHandlePoint(
				createTestTerrain(scene, () => null),
				TEST_STRUCTURE,
				TEST_CURSOR_M,
			),
		).toBeNull();
		expect(
			clampPoint({
				x: MAX_STRUCTURE_EXTENT_M + 1,
				y: -MAX_STRUCTURE_EXTENT_M - 1,
				z: 0,
			}),
		).toEqual({ x: MAX_STRUCTURE_EXTENT_M, y: -MAX_STRUCTURE_EXTENT_M, z: 0 });
	});
	it.each(TEST_XYZ_ROTATIONS_DEG)(
		"preserves the stored XYZ rotation $x/$y/$z",
		(rotationDeg) => {
			const rotation = elementRotation(rotationDeg);
			const roundTrip = elementRotation(elementRotationDegrees(rotation));
			expect(Math.abs(Quaternion.Dot(rotation, roundTrip))).toBeCloseTo(1);
		},
	);
});
