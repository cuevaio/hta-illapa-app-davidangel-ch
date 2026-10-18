import {
	Color3,
	Constants,
	Matrix,
	NullEngine,
	PBRMaterial,
	Ray,
	Scene,
	TransformNode,
	Vector3,
	VertexBuffer,
	Viewport,
} from "@babylonjs/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { framePoints, modelFramePoints } from "../camera";
import {
	CAMERA_FAR_M,
	CAMERA_FOCUS_FILL_RATIO,
	CAMERA_FOV_RAD,
	CAMERA_NEAR_M,
	DECK_THICKNESS_M,
	HALF_RATIO,
	OVERLAY_RENDER_GROUP_ID,
	ROAD_LIFT_M,
	TUNNEL_LINING_M,
} from "../constants";
import {
	createRoadMesh,
	createStructureModel,
	createTunnelShell,
	type ScenePalette,
} from "../models";
import {
	TEST_GRADIENT_RATIO,
	TEST_GROUND_M,
	TEST_INSETS,
	TEST_MISSING_DEM_HALF_WIDTH_M,
	TEST_RAY_START_M,
	TEST_ROAD_HALF_LENGTH_M,
	TEST_STRUCTURE,
	TEST_TUNNEL_HEIGHT_M,
	TEST_TUNNEL_LENGTH_M,
	TEST_TUNNEL_WIDTH_M,
	TEST_VIEW_HEIGHT_PX,
	TEST_VIEW_WIDTH_PX,
} from "./constants";
import { createTestTerrain } from "./terrain";

const palette: ScenePalette = {
	color: () => Color3.White(),
	css: () => "#ffffff",
};
let engine: NullEngine;
let scene: Scene;
beforeEach(() => {
	engine = new NullEngine();
	scene = new Scene(engine);
	scene.useRightHandedSystem = true;
});
afterEach(() => engine.dispose());

describe("Babylon structure meshes", () => {
	it("keeps bridge supports opaque and in contact with the terrain without filling selection overlays", () => {
		const concreteColor = Color3.Gray();
		const model = createStructureModel(
			scene,
			TEST_STRUCTURE,
			createTestTerrain(scene),
			{ color: () => concreteColor, css: () => concreteColor.toHexString() },
			new TransformNode("world", scene),
		);
		const deck = model.meshes.find((mesh) => mesh.name === "bridge-deck");
		if (!deck || !(deck.material instanceof PBRMaterial))
			throw new Error("Missing bridge deck");
		const material = deck.material;
		model.outline(Color3.Blue());
		expect(deck.material).toBe(material);
		const displayedColor = material.albedoColor.toGammaSpace();
		expect(displayedColor.r).toBeCloseTo(concreteColor.r);
		expect(displayedColor.g).toBeCloseTo(concreteColor.g);
		expect(displayedColor.b).toBeCloseTo(concreteColor.b);
		expect(material.alpha).toBe(1);
		for (const support of model.meshes.filter(
			(mesh) => mesh.name === "bridge-abutment" || mesh.name === "bridge-pier",
		)) {
			support.computeWorldMatrix(true);
			expect(support.isEnabled()).toBe(true);
			expect(support.isVisible).toBe(true);
			expect(support.material?.alpha).toBe(1);
			expect(support.getBoundingInfo().boundingBox.minimumWorld.y).toBeCloseTo(
				TEST_GROUND_M,
			);
			expect(
				support.getBoundingInfo().boundingBox.maximumWorld.y,
			).toBeGreaterThan(TEST_GROUND_M);
		}
		for (const overlay of scene.meshes.filter((mesh) =>
			mesh.name.endsWith("-outline"),
		))
			expect(overlay.material?.alpha).toBe(0);
	});
	it("keeps anchors and elements in the stored right-handed metric frame", () => {
		const terrain = createTestTerrain(scene);
		const parent = new TransformNode("world", scene);
		const model = createStructureModel(
			scene,
			TEST_STRUCTURE,
			terrain,
			palette,
			parent,
		);
		expect(model.root.parent).toBe(parent);
		expect(model.root.position.y).toBe(TEST_STRUCTURE.anchor.elevationM);
		const element = TEST_STRUCTURE.elements[0];
		if (!element) throw new Error("Missing fixture element");
		const node = model.elements.get(element.id);
		expect(node?.position.asArray()).toEqual([
			element.position.x,
			element.position.y,
			element.position.z,
		]);
		const deck = model.meshes.find((mesh) => mesh.name === "bridge-deck");
		expect(deck).toBeDefined();
		if (TEST_STRUCTURE.template.kind !== "bridge" || !deck)
			throw new Error("Missing fixture bridge");
		deck.computeWorldMatrix(true);
		const direction = Vector3.TransformNormal(
			Vector3.Forward(),
			deck.getWorldMatrix(),
		).normalize();
		const expected = new Vector3(
			TEST_STRUCTURE.template.end.x - TEST_STRUCTURE.template.start.x,
			TEST_STRUCTURE.template.end.y - TEST_STRUCTURE.template.start.y,
			TEST_STRUCTURE.template.end.z - TEST_STRUCTURE.template.start.z,
		).normalize();
		deck.computeWorldMatrix(true);
		expect(Vector3.Dot(direction, expected)).toBeCloseTo(1);
		expect(
			model.meshes.filter((mesh) => mesh.name === "bridge-abutment"),
		).toHaveLength(2);
		expect(
			model.meshes.filter((mesh) => mesh.name === "bridge-pier"),
		).toHaveLength(TEST_STRUCTURE.template.pierCount);
		expect(deck.position.y).toBe(
			(TEST_STRUCTURE.template.start.y +
				TEST_STRUCTURE.template.end.y -
				DECK_THICKNESS_M) *
				HALF_RATIO,
		);
	});

	it("keeps selection overlays visible over coarse DEM and reuses an unchanged outline", () => {
		const defaultMaterial = scene.defaultMaterial;
		const model = createStructureModel(
			scene,
			TEST_STRUCTURE,
			createTestTerrain(scene),
			palette,
			new TransformNode("world", scene),
		);
		model.outline(Color3.White());
		const count = scene.meshes.length;
		const overlays = scene.meshes.filter((mesh) =>
			mesh.name.endsWith("-outline"),
		);
		expect(overlays.length).toBe(model.meshes.length);
		for (const overlay of overlays) {
			expect(overlay.isPickable).toBe(false);
			expect(overlay.renderingGroupId).toBe(OVERLAY_RENDER_GROUP_ID);
			expect(overlay.material?.depthFunction).toBe(Constants.ALWAYS);
		}
		model.outline(Color3.White());
		expect(scene.meshes.length).toBe(count);
		model.dispose();
		expect(scene.meshes).toHaveLength(0);
		expect(
			scene.materials.every(
				(material) =>
					material === defaultMaterial || material.name === "lineShader",
			),
		).toBe(true);
	});

	it.each(["horseshoe", "circular"] satisfies ("horseshoe" | "circular")[])(
		"leaves the %s bore open through its portals",
		(shape) => {
			const shell = createTunnelShell(
				scene,
				"test-bore",
				{
					kind: "tunnel",
					start: { x: 0, y: 0, z: 0 },
					end: { x: 0, y: 0, z: TEST_TUNNEL_LENGTH_M },
					sectionWidthM: TEST_TUNNEL_WIDTH_M,
					sectionHeightM: TEST_TUNNEL_HEIGHT_M,
					shape,
				},
				TEST_TUNNEL_LENGTH_M,
			);
			shell.computeWorldMatrix(true);
			const opening = new Ray(
				new Vector3(0, TEST_TUNNEL_HEIGHT_M * HALF_RATIO, TEST_RAY_START_M),
				Vector3.Forward(),
			);
			expect(scene.pickWithRay(opening)?.hit).toBe(false);
			const lining = new Ray(
				new Vector3(
					TEST_TUNNEL_WIDTH_M * HALF_RATIO + TUNNEL_LINING_M * HALF_RATIO,
					TEST_TUNNEL_HEIGHT_M * HALF_RATIO,
					TEST_RAY_START_M,
				),
				Vector3.Forward(),
			);
			expect(scene.pickWithRay(lining)?.hit).toBe(true);
		},
	);

	it("drapes a bypass over loaded samples and never joins across a DEM hole", () => {
		const terrain = createTestTerrain(scene, (point) =>
			Math.abs(point.x) < TEST_MISSING_DEM_HALF_WIDTH_M
				? null
				: TEST_GROUND_M + point.x * TEST_GRADIENT_RATIO,
		);
		const road = createRoadMesh(
			scene,
			{
				...TEST_STRUCTURE,
				template: {
					kind: "bypass",
					points: [
						{ x: -TEST_ROAD_HALF_LENGTH_M, y: 0, z: 0 },
						{ x: TEST_ROAD_HALF_LENGTH_M, y: 0, z: 0 },
					],
					laneCount: 2,
					laneWidthM: 3,
				},
				elements: [],
			},
			terrain,
		);
		const positions =
			road.surface.getVerticesData(VertexBuffer.PositionKind) ?? [];
		const indices = road.surface.getIndices() ?? [];
		expect(indices.length).toBeGreaterThan(0);
		for (const vertexIndex of indices) {
			const eastM = positions[vertexIndex * 3] ?? 0;
			const heightM = positions[vertexIndex * 3 + 1];
			expect(Math.abs(eastM)).toBeGreaterThanOrEqual(
				TEST_MISSING_DEM_HALF_WIDTH_M,
			);
			expect(heightM).toBeCloseTo(
				TEST_GROUND_M +
					eastM * TEST_GRADIENT_RATIO -
					TEST_STRUCTURE.anchor.elevationM +
					ROAD_LIFT_M,
			);
		}
		for (
			let triangleIndex = 0;
			triangleIndex < indices.length;
			triangleIndex += 3
		) {
			const eastCoordinates = indices
				.slice(triangleIndex, triangleIndex + 3)
				.map((index) => positions[index * 3] ?? 0);
			expect(
				Math.min(...eastCoordinates) < 0 && Math.max(...eastCoordinates) > 0,
			).toBe(false);
		}
	});

	it("frames the complete structure inside 45 percent of the free panel area", () => {
		const model = createStructureModel(
			scene,
			TEST_STRUCTURE,
			createTestTerrain(scene),
			palette,
			new TransformNode("world", scene),
		);
		const points = modelFramePoints(model);
		const frame = framePoints(
			points,
			TEST_INSETS,
			TEST_VIEW_WIDTH_PX,
			TEST_VIEW_HEIGHT_PX,
		);
		const transform = Matrix.LookAtRH(
			frame.position,
			frame.target,
			Vector3.Up(),
		).multiply(
			Matrix.PerspectiveFovRH(
				CAMERA_FOV_RAD,
				TEST_VIEW_WIDTH_PX / TEST_VIEW_HEIGHT_PX,
				CAMERA_NEAR_M,
				CAMERA_FAR_M,
			),
		);
		const screenPoints = points.map((point) =>
			Vector3.Project(
				point,
				Matrix.IdentityReadOnly,
				transform,
				new Viewport(0, 0, TEST_VIEW_WIDTH_PX, TEST_VIEW_HEIGHT_PX),
			),
		);
		const widthPx =
			Math.max(...screenPoints.map((point) => point.x)) -
			Math.min(...screenPoints.map((point) => point.x));
		const heightPx =
			Math.max(...screenPoints.map((point) => point.y)) -
			Math.min(...screenPoints.map((point) => point.y));
		expect(
			widthPx / (TEST_VIEW_WIDTH_PX - TEST_INSETS.leftPx - TEST_INSETS.rightPx),
		).toBeLessThanOrEqual(CAMERA_FOCUS_FILL_RATIO);
		expect(
			heightPx /
				(TEST_VIEW_HEIGHT_PX - TEST_INSETS.topPx - TEST_INSETS.bottomPx),
		).toBeLessThanOrEqual(CAMERA_FOCUS_FILL_RATIO);
	});
});
