import { POSITION_COMPONENTS_COUNT, SQUARE_EDGES_COUNT } from "../constants";

/**
 * Unit-square grid shared by every tile. `position.xz` holds the tile UV
 * (v = 0 at the northern edge); `aSkirt` = 1 marks the skirt ring that the
 * vertex shader pushes downward to hide cracks between LOD levels.
 */
export interface TileGridBuffers {
	positions: Float32Array;
	skirt: Float32Array;
	indices: number[];
}

export function createTileGridBuffers(segments: number): TileGridBuffers {
	const verticesPerEdge = segments + 1;
	const gridCount = verticesPerEdge * verticesPerEdge;
	const skirtCount = segments * SQUARE_EDGES_COUNT;
	const positions = new Float32Array(
		(gridCount + skirtCount) * POSITION_COMPONENTS_COUNT,
	);
	const skirt = new Float32Array(gridCount + skirtCount);

	for (let rowIndex = 0; rowIndex < verticesPerEdge; rowIndex++) {
		for (let columnIndex = 0; columnIndex < verticesPerEdge; columnIndex++) {
			const positionOffset =
				(rowIndex * verticesPerEdge + columnIndex) * POSITION_COMPONENTS_COUNT;
			positions[positionOffset] = columnIndex / segments;
			positions[positionOffset + 2] = rowIndex / segments;
		}
	}

	// Border vertex indices in northwestIndex closed loop (N edge, E edge, S edge, W edge).
	const border: number[] = [];
	for (let columnIndex = 0; columnIndex < segments; columnIndex++)
		border.push(columnIndex);
	for (let rowIndex = 0; rowIndex < segments; rowIndex++)
		border.push(rowIndex * verticesPerEdge + segments);
	for (let columnIndex = segments; columnIndex > 0; columnIndex--)
		border.push(segments * verticesPerEdge + columnIndex);
	for (let rowIndex = segments; rowIndex > 0; rowIndex--)
		border.push(rowIndex * verticesPerEdge);

	border.forEach((gridIndex, borderIndex) => {
		const positionOffset =
			(gridCount + borderIndex) * POSITION_COMPONENTS_COUNT;
		positions.set(
			positions.subarray(
				gridIndex * POSITION_COMPONENTS_COUNT,
				(gridIndex + 1) * POSITION_COMPONENTS_COUNT,
			),
			positionOffset,
		);
		skirt[gridCount + borderIndex] = 1;
	});

	const indices: number[] = [];
	for (let rowIndex = 0; rowIndex < segments; rowIndex++) {
		for (let columnIndex = 0; columnIndex < segments; columnIndex++) {
			const northwestIndex = rowIndex * verticesPerEdge + columnIndex;
			const northeastIndex = northwestIndex + 1;
			const southwestIndex = northwestIndex + verticesPerEdge;
			const southeastIndex = southwestIndex + 1;
			// Counter-clockwise when viewed from above (+y), with v growing toward +z.
			indices.push(
				northwestIndex,
				southwestIndex,
				northeastIndex,
				northeastIndex,
				southwestIndex,
				southeastIndex,
			);
		}
	}
	for (let borderIndex = 0; borderIndex < border.length; borderIndex++) {
		const currentTopIndex = Number(border[borderIndex]);
		const nextTopIndex = Number(border[(borderIndex + 1) % border.length]);
		const currentBottomIndex = gridCount + borderIndex;
		const nextBottomIndex = gridCount + ((borderIndex + 1) % border.length);
		indices.push(
			currentTopIndex,
			nextTopIndex,
			currentBottomIndex,
			nextTopIndex,
			nextBottomIndex,
			currentBottomIndex,
		);
	}

	return { positions, skirt, indices };
}
