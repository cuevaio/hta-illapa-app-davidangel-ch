import { MAX_STRUCTURE_EXTENT_M } from "@hack-the-andes-project/business/structures/constants";
import { Group, Ray, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { GRID_CELL_M, GRID_SIZE_M } from "../constants";
import {
	clampStructurePoint,
	groundFromPointer,
	PointerGestures,
	snapHandlePoint,
} from "../interaction";
import { TerrainPicker } from "../picking";
import { createGridGeometry, drapeGridGeometry } from "../terrain-grid";
import { TEST_ANCHOR_ELEVATION_M } from "./constants";
import { testTerrain } from "./terrain";

describe("desktop and XR gestures", () => {
	it("never reads XR delta and distinguishes orbit from click", () => {
		const gestures = new PointerGestures();
		const sample = {
			pointerId: 1,
			pointerType: "mouse",
			clientX: 10,
			clientY: 20,
			point: new Vector3(),
			get delta(): number {
				throw new Error("unsupported");
			},
		};
		gestures.down(sample);
		expect(gestures.isClick(sample)).toBe(true);
		expect(
			gestures.isClick({
				pointerId: 1,
				pointerType: "mouse",
				clientX: 20,
				clientY: 20,
				point: new Vector3(),
			}),
		).toBe(false);
	});
	it("measures XR clicks in world metres", () => {
		const gestures = new PointerGestures();
		gestures.down({ pointerId: 1, pointerType: "grab", point: new Vector3() });
		expect(
			gestures.isClick({
				pointerId: 1,
				pointerType: "grab",
				point: new Vector3(0.01, 0, 0),
			}),
		).toBe(true);
		expect(
			gestures.isClick({
				pointerId: 1,
				pointerType: "grab",
				point: new Vector3(1, 0, 0),
			}),
		).toBe(false);
	});
	it("projects hand contact onto ground in the scaled terrain frame", () => {
		const group = new Group();
		group.scale.setScalar(0.01);
		group.updateMatrixWorld(true);
		const terrain = testTerrain({ group });
		const pick = vi.spyOn(terrain, "pick");
		const hit = groundFromPointer(terrain, {
			point: new Vector3(1, 1, 2),
			pointerType: "grab",
			ray: new Ray(),
		});
		expect(hit?.toArray()).toEqual([100, TEST_ANCHOR_ELEVATION_M, 200]);
		expect(pick).not.toHaveBeenCalled();
	});
	it("snaps handles to the origin-aligned grid despite fractional anchors", () => {
		const anchor = { x: 2.5, y: TEST_ANCHOR_ELEVATION_M, z: 3 };
		const hit = snapHandlePoint(testTerrain(), anchor, { x: 12, y: 0, z: 18 });
		expect(hit && (hit.x + anchor.x) % GRID_CELL_M).toBe(0);
		expect(hit && (hit.z + anchor.z) % GRID_CELL_M).toBe(0);
	});
	it("clamps edits to the persisted extent", () => {
		expect(
			clampStructurePoint({
				x: Number.POSITIVE_INFINITY,
				y: Number.NEGATIVE_INFINITY,
				z: 0,
			}),
		).toEqual({ x: MAX_STRUCTURE_EXTENT_M, y: -MAX_STRUCTURE_EXTENT_M, z: 0 });
	});
	it("reuses a terrain hit for the pointer surface and placement in one frame", () => {
		const terrain = testTerrain();
		const pick = vi.spyOn(terrain, "pick");
		const picker = new TerrainPicker(terrain);
		const ray = new Ray(new Vector3(0, 3000, 0), new Vector3(0, -1, 0));
		picker.pick(ray);
		picker.pick(ray);
		expect(pick).toHaveBeenCalledTimes(1);
		picker.nextFrame();
		picker.pick(ray);
		expect(pick).toHaveBeenCalledTimes(2);
	});
	it("drapes each grid intersection once while retaining GPU buffers", () => {
		const terrain = testTerrain();
		const height = vi.spyOn(terrain, "heightAt");
		const geometry = createGridGeometry();
		const positions = geometry.getAttribute("position");
		drapeGridGeometry(geometry, terrain, { x: 0, z: 0 });
		expect(height).toHaveBeenCalledTimes((GRID_SIZE_M / GRID_CELL_M + 1) ** 2);
		drapeGridGeometry(geometry, terrain, { x: 50, z: 0 });
		expect(geometry.getAttribute("position")).toBe(positions);
		geometry.dispose();
	});
});
