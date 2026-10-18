import {
	BRIDGE_PARAMETERS,
	PRIMITIVE_DEFAULTS,
} from "@hack-the-andes-project/business/structures/catalog";
import {
	BoxGeometry,
	Group,
	Mesh,
	MeshBasicMaterial,
	PerspectiveCamera,
	Raycaster,
	Vector3,
} from "three";
import { describe, expect, it, vi } from "vitest";
import { DECK_THICKNESS_M } from "../constants";
import { pickPlacement } from "../picking";
import { TEST_ANCHOR_ELEVATION_M } from "./constants";
import { testTerrain } from "./terrain";

function setupPicking(
	deckCenterY = TEST_ANCHOR_ELEVATION_M + PRIMITIVE_DEFAULTS.block.heightM,
) {
	const terrain = testTerrain();
	const root = new Group();
	const deck = new Mesh(
		new BoxGeometry(
			BRIDGE_PARAMETERS.deckWidthM.default,
			DECK_THICKNESS_M,
			BRIDGE_PARAMETERS.defaultSpanM,
		),
		new MeshBasicMaterial(),
	);
	deck.position.y = deckCenterY;
	root.add(deck);
	root.updateMatrixWorld(true);
	const raycaster = new Raycaster(
		new Vector3(
			0,
			TEST_ANCHOR_ELEVATION_M + PRIMITIVE_DEFAULTS.block.heightM * 2,
			0,
		),
		new Vector3(0, -1, 0),
	);
	return {
		terrain,
		root,
		raycaster,
		dispose: () => {
			deck.geometry.dispose();
			deck.material.dispose();
		},
	};
}

describe("placement surface picking", () => {
	it("puts primitives on top of the nearest deck", () => {
		const { terrain, root, raycaster, dispose } = setupPicking();
		expect(
			pickPlacement(
				terrain,
				raycaster,
				root,
				{ primitive: "column" },
				terrain.pick(raycaster.ray),
				new PerspectiveCamera(),
			)?.y,
		).toBe(
			TEST_ANCHOR_ELEVATION_M +
				PRIMITIVE_DEFAULTS.block.heightM +
				DECK_THICKNESS_M / 2,
		);
		dispose();
	});
	it("always puts templates on terrain through a deck", () => {
		const { terrain, root, raycaster, dispose } = setupPicking();
		expect(
			pickPlacement(
				terrain,
				raycaster,
				root,
				{ kind: "bridge" },
				terrain.pick(raycaster.ray),
				new PerspectiveCamera(),
			)?.y,
		).toBe(TEST_ANCHOR_ELEVATION_M);
		dispose();
	});
	it("ignores a buried structure when terrain is closer", () => {
		const { terrain, root, raycaster, dispose } = setupPicking(
			TEST_ANCHOR_ELEVATION_M - PRIMITIVE_DEFAULTS.block.heightM,
		);
		expect(
			pickPlacement(
				terrain,
				raycaster,
				root,
				{ primitive: "block" },
				terrain.pick(raycaster.ray),
				new PerspectiveCamera(),
			)?.y,
		).toBe(TEST_ANCHOR_ELEVATION_M);
		dispose();
	});
	it("excludes Mesh-derived line decorations and supplies the render camera", () => {
		const { terrain, root, raycaster, dispose } = setupPicking();
		const decoration = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
		Object.defineProperty(decoration, "type", { value: "Line2" });
		const cast = vi.spyOn(decoration, "raycast");
		root.add(decoration);
		const camera = new PerspectiveCamera();
		pickPlacement(
			terrain,
			raycaster,
			root,
			{ primitive: "block" },
			terrain.pick(raycaster.ray),
			camera,
		);
		expect(cast).not.toHaveBeenCalled();
		expect(raycaster.camera).toBe(camera);
		decoration.geometry.dispose();
		decoration.material.dispose();
		dispose();
	});
	it("reports no hit when the terrain and structures are absent", () => {
		const { terrain, raycaster, dispose } = setupPicking();
		expect(
			pickPlacement(
				{ ...terrain, pick: () => null },
				raycaster,
				null,
				{
					kind: "tunnel",
				},
				null,
				new PerspectiveCamera(),
			),
		).toBeNull();
		dispose();
	});
});
