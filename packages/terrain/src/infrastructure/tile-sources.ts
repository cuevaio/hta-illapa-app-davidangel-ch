import { MAX_ELEVATION_ZOOM_LEVEL, MAX_IMAGERY_ZOOM_LEVEL } from "../constants";
import type { TileId } from "../domain/types";
import type { DecodedHeightTile } from "./decode-protocol";
import type { DecoderPool } from "./decoder-pool";

export const ELEVATION_SOURCE = {
	maxZoom: MAX_ELEVATION_ZOOM_LEVEL,
	url: (tile: TileId) =>
		`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${tile.z}/${tile.x}/${tile.y}.png`,
};

export const IMAGERY_SOURCE = {
	maxZoom: MAX_IMAGERY_ZOOM_LEVEL,
	attribution:
		"Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
	url: (tile: TileId) =>
		`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${tile.z}/${tile.y}/${tile.x}`,
};

export const ELEVATION_ATTRIBUTION =
	"Elevation: Tilezen Joerd / AWS Terrain Tiles (Mapzen and data providers)";

export async function loadHeightTile(
	pool: DecoderPool,
	tile: TileId,
	signal: AbortSignal,
): Promise<DecodedHeightTile> {
	const response = await fetch(ELEVATION_SOURCE.url(tile), {
		signal,
		mode: "cors",
	});
	if (!response.ok) throw new Error(`Elevation HTTP ${response.status}`);
	return pool.decode(await response.arrayBuffer(), signal);
}

export async function loadImageryTile(
	tile: TileId,
	signal: AbortSignal,
): Promise<ImageBitmap> {
	const response = await fetch(IMAGERY_SOURCE.url(tile), {
		signal,
		mode: "cors",
	});
	if (!response.ok) throw new Error(`Imagery HTTP ${response.status}`);
	// createImageBitmap decodes off the main thread.
	return createImageBitmap(await response.blob());
}
