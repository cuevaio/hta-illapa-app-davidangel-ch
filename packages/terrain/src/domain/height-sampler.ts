import type { DecodedHeightTile } from "../infrastructure/decode-protocol";
import { fromHalfFloat } from "./half-float";
import {
	lonLatToMercator,
	lonLatToTile,
	tileBoundsMercator,
	tileKey,
} from "./tile-math";

export interface HeightDataResource {
	readonly tile: DecodedHeightTile;
}

export class HeightSampler {
	constructor(
		private readonly lookup: (key: string) => HeightDataResource | undefined,
		private readonly maxZoom: number,
	) {}

	sample(lon: number, lat: number): number | null {
		const mercator = lonLatToMercator(lon, lat);
		for (let zoom = this.maxZoom; zoom >= 0; zoom--) {
			const tile = lonLatToTile(lon, lat, zoom);
			const resource = this.lookup(tileKey(tile));
			if (!resource) continue;
			const bounds = tileBoundsMercator(tile);
			const { width, height, heights, offset } = resource.tile;
			const column = Math.min(
				width - 1,
				Math.max(
					0,
					((mercator.x - bounds.minX) / (bounds.maxX - bounds.minX)) *
						(width - 1),
				),
			);
			const row = Math.min(
				height - 1,
				Math.max(
					0,
					((bounds.maxY - mercator.y) / (bounds.maxY - bounds.minY)) *
						(height - 1),
				),
			);
			const columnBefore = Math.floor(column);
			const rowBefore = Math.floor(row);
			const columnAfter = Math.min(width - 1, columnBefore + 1);
			const rowAfter = Math.min(height - 1, rowBefore + 1);
			const northWest = heights[rowBefore * width + columnBefore];
			const northEast = heights[rowBefore * width + columnAfter];
			const southWest = heights[rowAfter * width + columnBefore];
			const southEast = heights[rowAfter * width + columnAfter];
			if (
				northWest === undefined ||
				northEast === undefined ||
				southWest === undefined ||
				southEast === undefined
			)
				return null;
			const fractionX = column - columnBefore;
			const fractionZ = row - rowBefore;
			const northHeight =
				fromHalfFloat(northWest) * (1 - fractionX) +
				fromHalfFloat(northEast) * fractionX;
			const southHeight =
				fromHalfFloat(southWest) * (1 - fractionX) +
				fromHalfFloat(southEast) * fractionX;
			return northHeight * (1 - fractionZ) + southHeight * fractionZ + offset;
		}
		return null;
	}
}
