import {
	BoxGeometry,
	Group,
	Mesh,
	MeshBasicMaterial,
	Raycaster,
	Vector3,
} from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { describe, expect, it, vi } from "vitest";
import { DecorativeEdges, DecorativeLine } from "../decorations";

interface DecorationProps {
	raycast?: LineSegments2["raycast"];
	pointerEvents?: string;
}
const points: [number, number, number][] = [
	[-1, 0, 0],
	[1, 0, 0],
];

describe("decorative scene geometry with XR raycasters", () => {
	const cases: { name: string; props: () => DecorationProps }[] = [
		{
			name: "railings, markings, rings and stems",
			props: () => DecorativeLine({ points }).props,
		},
		{ name: "selection edges", props: () => DecorativeEdges({}).props },
	];
	for (const decoration of cases) {
		it(`${decoration.name} never invokes camera-dependent line intersection`, () => {
			const scene = new Group();
			const geometry = new LineSegmentsGeometry().setPositions(points.flat());
			const line = new LineSegments2(geometry);
			const props = decoration.props();
			if (props.raycast) line.raycast = props.raycast;
			scene.add(line);
			const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
			scene.add(mesh);
			scene.updateMatrixWorld(true);
			const raycaster = new Raycaster(
				new Vector3(0, 0, 2),
				new Vector3(0, 0, -1),
			);
			const consoleError = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			try {
				expect(raycaster.camera).toBeNull();
				expect(() => raycaster.intersectObject(scene, true)).not.toThrow();
				expect(consoleError).not.toHaveBeenCalled();
				expect(props.pointerEvents).toBe("none");
				expect(
					raycaster.intersectObject(scene, true).map((hit) => hit.object),
				).toContain(mesh);
				expect(
					raycaster.intersectObject(scene, true).map((hit) => hit.object),
				).not.toContain(line);
			} finally {
				consoleError.mockRestore();
				geometry.dispose();
				line.material.dispose();
				mesh.geometry.dispose();
				mesh.material.dispose();
			}
		});
	}
});
