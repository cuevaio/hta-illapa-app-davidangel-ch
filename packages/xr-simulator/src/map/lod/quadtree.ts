import {
	type LonLatBox,
	lonLatToWorld,
	metresPerWorldUnit,
	PERU_BBOX,
	type TileId,
	worldToLonLat,
} from "../tileMath";

/**
 * Quadtree helpers for the streamed Peru relief and its local frame. Pure.
 * World = Web Mercator unit square (y grows southward); local = overview scene km
 * (x east, z north) around the Peru bbox centre, as the static overview used.
 */

export type Vec3 = [number, number, number];

export const tileKey = (t: TileId): string => `${t.z}/${t.x}/${t.y}`;

export function parseTileKey(key: string): TileId {
	const [z, x, y] = key.split("/").map(Number);
	return { z, x, y };
}

/** NW, NE, SW, SE. */
export function childrenOf(t: TileId): TileId[] {
	const z = t.z + 1;
	const x = 2 * t.x;
	const y = 2 * t.y;
	return [
		{ z, x, y },
		{ z, x: x + 1, y },
		{ z, x, y: y + 1 },
		{ z, x: x + 1, y: y + 1 },
	];
}

export function parentOf(t: TileId): TileId | null {
	return t.z === 0 ? null : { z: t.z - 1, x: t.x >> 1, y: t.y >> 1 };
}

/** True when `a` is a strict ancestor of `b`. */
export function isAncestor(a: TileId, b: TileId): boolean {
	if (a.z >= b.z) return false;
	const d = b.z - a.z;
	return b.x >> d === a.x && b.y >> d === a.y;
}

/** Where `tile` sits inside the texture of `ancestor`: uv = offset + tileUv · scale. */
export function ancestorUv(
	tile: TileId,
	ancestor: TileId,
): { offsetU: number; offsetV: number; scale: number } {
	const k = 2 ** (tile.z - ancestor.z);
	return {
		offsetU: (tile.x - ancestor.x * k) / k,
		offsetV: (tile.y - ancestor.y * k) / k,
		scale: 1 / k,
	};
}

export interface WorldBox {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export function tileWorldBox(t: TileId): WorldBox {
	const n = 2 ** t.z;
	return {
		minX: t.x / n,
		minY: t.y / n,
		maxX: (t.x + 1) / n,
		maxY: (t.y + 1) / n,
	};
}

export function lonLatBoxWorld(b: LonLatBox): WorldBox {
	const nw = lonLatToWorld(b.west, b.north);
	const se = lonLatToWorld(b.east, b.south);
	return { minX: nw.x, minY: nw.y, maxX: se.x, maxY: se.y };
}

export function boxesOverlap(a: WorldBox, b: WorldBox): boolean {
	return (
		a.maxX > b.minX && a.minX < b.maxX && a.maxY > b.minY && a.minY < b.maxY
	);
}

/** Local km frame: x = (wx − ox)·k, z = −(wy − oy)·k. */
export interface LocalFrame {
	ox: number;
	oy: number;
	/** Scene km per world unit (ground metres at the origin latitude / 1000). */
	k: number;
}

/** The overview frame: origin at the Peru bbox centre, scale at its latitude. */
export function peruFrame(): LocalFrame {
	const lat = (PERU_BBOX.south + PERU_BBOX.north) / 2;
	const o = lonLatToWorld((PERU_BBOX.west + PERU_BBOX.east) / 2, lat);
	return { ox: o.x, oy: o.y, k: metresPerWorldUnit(lat) / 1000 };
}

export function worldToLocal(
	f: LocalFrame,
	wx: number,
	wy: number,
): [number, number] {
	return [(wx - f.ox) * f.k, -(wy - f.oy) * f.k];
}

export function localToWorld(
	f: LocalFrame,
	x: number,
	z: number,
): [number, number] {
	return [f.ox + x / f.k, f.oy - z / f.k];
}

export function localToLonLat(
	f: LocalFrame,
	x: number,
	z: number,
): { lon: number; lat: number } {
	const [wx, wy] = localToWorld(f, x, z);
	return worldToLonLat(wx, wy);
}

/** Tile footprint in the local frame: west edge x, north edge z and side (km); v grows southward. */
export function tileRect(
	f: LocalFrame,
	t: TileId,
): { west: number; north: number; size: number } {
	const b = tileWorldBox(t);
	const [west, north] = worldToLocal(f, b.minX, b.minY);
	return { west, north, size: (b.maxX - b.minX) * f.k };
}

/** Tile at zoom z containing the local point (unclamped). */
export function tileAtLocal(
	f: LocalFrame,
	x: number,
	z: number,
	zoom: number,
): TileId {
	const [wx, wy] = localToWorld(f, x, z);
	const n = 2 ** zoom;
	return { z: zoom, x: Math.floor(wx * n), y: Math.floor(wy * n) };
}
