import { type HeightGrid, resampleGrid } from "./terrain";

/** Rectangular raster as decoded from a file, before cropping/resampling. */
export interface Raster {
	width: number;
	height: number;
	/** Ground spacing between samples (m). */
	cellSize: number;
	data: ArrayLike<number>;
	noData?: number | null;
}

export interface PngDemOptions {
	/** Ground spacing between pixels (m); PNG files carry no georeference. */
	cellSize: number;
	/** Elevation mapped to pixel value 0 (m). */
	minElevation: number;
	/** Elevation mapped to the maximum pixel value (m). */
	maxElevation: number;
}

/**
 * Crops the centred square of a raster, fills no-data with the lowest valid
 * elevation, and resamples it to `resolution`² cells.
 */
export function rasterToHeightGrid(
	raster: Raster,
	resolution: number,
): HeightGrid {
	const side = Math.min(raster.width, raster.height);
	if (side < 2) throw new Error("El DEM es demasiado pequeño");
	const x0 = Math.floor((raster.width - side) / 2);
	const y0 = Math.floor((raster.height - side) / 2);
	const isValid = (v: number) =>
		Number.isFinite(v) && (raster.noData == null || v !== raster.noData);
	let lowest = Number.POSITIVE_INFINITY;
	for (let k = 0; k < raster.data.length; k++) {
		const v = raster.data[k];
		if (isValid(v) && v < lowest) lowest = v;
	}
	if (!Number.isFinite(lowest))
		throw new Error("El DEM no contiene elevaciones válidas");
	const square = new Float32Array(side * side);
	for (let j = 0; j < side; j++) {
		for (let i = 0; i < side; i++) {
			const v = raster.data[(y0 + j) * raster.width + x0 + i];
			square[j * side + i] = isValid(v) ? v : lowest;
		}
	}
	return resampleGrid(
		{ resolution: side, cellSize: raster.cellSize, heights: square },
		resolution,
	);
}

export async function loadGeoTiff(
	file: Blob,
	resolution: number,
): Promise<HeightGrid> {
	const { fromBlob } = await import("geotiff");
	const tiff = await fromBlob(file);
	const image = await tiff.getImage();
	const [band] = await image.readRasters({ samples: [0], interleave: false });
	const [resX, resY] = image.getResolution().map(Math.abs);
	let cellSize = (resX + resY) / 2;
	// Geographic CRS (degrees): convert to metres at the raster's mid latitude.
	if (cellSize < 0.01) {
		const [, minY, , maxY] = image.getBoundingBox();
		const lat = ((minY + maxY) / 2) * (Math.PI / 180);
		cellSize = (resX * 111_320 * Math.cos(lat) + resY * 110_540) / 2;
	}
	return rasterToHeightGrid(
		{
			width: image.getWidth(),
			height: image.getHeight(),
			cellSize,
			data: band as ArrayLike<number>,
			noData: image.getGDALNoData(),
		},
		resolution,
	);
}

export async function loadPng16(
	file: Blob,
	resolution: number,
	options: PngDemOptions,
): Promise<HeightGrid> {
	const { decode } = await import("fast-png");
	const png = decode(new Uint8Array(await file.arrayBuffer()));
	const maxValue = 2 ** png.depth - 1;
	const span = options.maxElevation - options.minElevation;
	const data = new Float32Array(png.width * png.height);
	for (let k = 0; k < data.length; k++) {
		data[k] =
			options.minElevation + (png.data[k * png.channels] / maxValue) * span;
	}
	return rasterToHeightGrid(
		{ width: png.width, height: png.height, cellSize: options.cellSize, data },
		resolution,
	);
}
