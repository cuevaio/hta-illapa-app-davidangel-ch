/**
 * Unit-square grid shared by every streamed tile (after peru-simulator's tile-geometry.ts).
 * Position = (u, skirt, v): u east, v south (0 = north edge); skirt = 1 marks the ring that
 * the vertex shader pulls down to hide cracks between LOD levels. Cells are split along the
 * (i+1, j)–(i, j+1) diagonal, the triangulation the geomorph and TileSurface assume.
 */
export function createTileGrid(segments: number): {
	positions: Float32Array;
	indices: Uint32Array;
} {
	const n = segments + 1;
	const gridCount = n * n;
	const border: number[] = [];
	for (let i = 0; i < segments; i++) border.push(i);
	for (let j = 0; j < segments; j++) border.push(j * n + segments);
	for (let i = segments; i > 0; i--) border.push(segments * n + i);
	for (let j = segments; j > 0; j--) border.push(j * n);

	const positions = new Float32Array((gridCount + border.length) * 3);
	for (let j = 0; j < n; j++) {
		for (let i = 0; i < n; i++) {
			const k = (j * n + i) * 3;
			positions[k] = i / segments;
			positions[k + 2] = j / segments;
		}
	}
	border.forEach((g, b) => {
		const k = (gridCount + b) * 3;
		positions[k] = positions[g * 3];
		positions[k + 1] = 1;
		positions[k + 2] = positions[g * 3 + 2];
	});

	const indices = new Uint32Array(segments * segments * 6 + border.length * 6);
	let p = 0;
	for (let j = 0; j < segments; j++) {
		for (let i = 0; i < segments; i++) {
			const a = j * n + i;
			const b = a + 1;
			const c = a + n;
			const d = c + 1;
			indices[p++] = a;
			indices[p++] = c;
			indices[p++] = b;
			indices[p++] = b;
			indices[p++] = c;
			indices[p++] = d;
		}
	}
	for (let b = 0; b < border.length; b++) {
		const top0 = border[b];
		const top1 = border[(b + 1) % border.length];
		const bottom0 = gridCount + b;
		const bottom1 = gridCount + ((b + 1) % border.length);
		indices[p++] = top0;
		indices[p++] = top1;
		indices[p++] = bottom0;
		indices[p++] = top1;
		indices[p++] = bottom1;
		indices[p++] = bottom0;
	}
	return { positions, indices };
}
