import { BufferAttribute, BufferGeometry } from "three";
import { POSITION_COMPONENTS_COUNT } from "../constants";
import { createTileGridBuffers } from "../domain/tile-grid";

export function createTileGeometry(segments: number): BufferGeometry {
	const { positions, skirt, indices } = createTileGridBuffers(segments);
	const geometry = new BufferGeometry();
	geometry.setAttribute(
		"position",
		new BufferAttribute(positions, POSITION_COMPONENTS_COUNT),
	);
	geometry.setAttribute("aSkirt", new BufferAttribute(skirt, 1));
	geometry.setIndex(indices);
	return geometry;
}
