import {
	EARTH_RADIUS_M,
	MAX_MERCATOR_LAT_DEG,
	RADIANS_PER_DEG,
	WORLD_HALF_SIZE_M,
} from "../constants";
import type { LonLat, LonLatBounds, MercatorBounds, TileId } from "./types";

export { WORLD_HALF_SIZE_M as WORLD_HALF_SIZE } from "../constants";

export function lonLatToMercator(
	lon: number,
	lat: number,
): { x: number; y: number } {
	const clampedLat = Math.max(
		-MAX_MERCATOR_LAT_DEG,
		Math.min(MAX_MERCATOR_LAT_DEG, lat),
	);
	return {
		x: EARTH_RADIUS_M * lon * RADIANS_PER_DEG,
		y:
			EARTH_RADIUS_M *
			Math.log(Math.tan(Math.PI / 4 + (clampedLat * RADIANS_PER_DEG) / 2)),
	};
}

export function mercatorToLonLat(x: number, y: number): LonLat {
	return {
		lon: x / EARTH_RADIUS_M / RADIANS_PER_DEG,
		lat:
			(2 * Math.atan(Math.exp(y / EARTH_RADIUS_M)) - Math.PI / 2) /
			RADIANS_PER_DEG,
	};
}

export function lonLatToTile(lon: number, lat: number, z: number): TileId {
	const tileCount = 2 ** z;
	const mercator = lonLatToMercator(lon, lat);
	const fractionX = (mercator.x + WORLD_HALF_SIZE_M) / (2 * WORLD_HALF_SIZE_M);
	const fractionY = (WORLD_HALF_SIZE_M - mercator.y) / (2 * WORLD_HALF_SIZE_M);
	const clamp = (fraction: number) =>
		Math.max(0, Math.min(tileCount - 1, Math.floor(fraction * tileCount)));
	return { z, x: clamp(fractionX), y: clamp(fractionY) };
}

export function tileBoundsMercator(tile: TileId): MercatorBounds {
	const size = (2 * WORLD_HALF_SIZE_M) / 2 ** tile.z;
	const minX = -WORLD_HALF_SIZE_M + tile.x * size;
	const maxY = WORLD_HALF_SIZE_M - tile.y * size;
	return { minX, maxX: minX + size, maxY, minY: maxY - size };
}

export function tileBoundsLonLat(tile: TileId): LonLatBounds {
	const mercator = tileBoundsMercator(tile);
	const southwest = mercatorToLonLat(mercator.minX, mercator.minY);
	const northeast = mercatorToLonLat(mercator.maxX, mercator.maxY);
	return {
		west: southwest.lon,
		south: southwest.lat,
		east: northeast.lon,
		north: northeast.lat,
	};
}

export function tileKey(tile: TileId): string {
	return `${tile.z}/${tile.x}/${tile.y}`;
}

export function parseTileKey(key: string): TileId {
	const [z, x, y] = key.split("/").map(Number);
	if (
		z === undefined ||
		x === undefined ||
		y === undefined ||
		[z, x, y].some(Number.isNaN)
	) {
		throw new Error(`Invalid tile key: ${key}`);
	}
	return { z, x, y };
}

export function childrenOf(tile: TileId): TileId[] {
	const z = tile.z + 1;
	const x = tile.x * 2;
	const y = tile.y * 2;
	return [
		{ z, x, y },
		{ z, x: x + 1, y },
		{ z, x, y: y + 1 },
		{ z, x: x + 1, y: y + 1 },
	];
}

export function ancestorAtZoom(tile: TileId, maxZoom: number): TileId {
	if (tile.z <= maxZoom) return tile;
	const zoomDifference = tile.z - maxZoom;
	return {
		z: maxZoom,
		x: tile.x >> zoomDifference,
		y: tile.y >> zoomDifference,
	};
}

export function parentOf(tile: TileId): TileId | null {
	if (tile.z === 0) return null;
	return { z: tile.z - 1, x: tile.x >> 1, y: tile.y >> 1 };
}

/** All tiles at zoom `z` that intersect the given lon/lat bounds. */
export function tilesCovering(bounds: LonLatBounds, z: number): TileId[] {
	const northwest = lonLatToTile(bounds.west, bounds.north, z);
	const southeast = lonLatToTile(bounds.east, bounds.south, z);
	const tiles: TileId[] = [];
	for (let y = northwest.y; y <= southeast.y; y++) {
		for (let x = northwest.x; x <= southeast.x; x++) tiles.push({ z, x, y });
	}
	return tiles;
}

/** Placement of a descendant tile inside its ancestor's [0, 1]^2 texture space (fraction grows southward). */
export interface AncestorUv {
	offsetU: number;
	offsetV: number;
	scale: number;
}

export function ancestorUvTransform(
	tile: TileId,
	ancestor: TileId,
): AncestorUv {
	const zoomDifference = tile.z - ancestor.z;
	if (
		zoomDifference < 0 ||
		tile.x >> zoomDifference !== ancestor.x ||
		tile.y >> zoomDifference !== ancestor.y
	) {
		throw new Error(
			`${tileKey(ancestor)} is not an ancestor of ${tileKey(tile)}`,
		);
	}
	const scale = 1 / 2 ** zoomDifference;
	return {
		offsetU: (tile.x - ancestor.x * 2 ** zoomDifference) * scale,
		offsetV: (tile.y - ancestor.y * 2 ** zoomDifference) * scale,
		scale,
	};
}
