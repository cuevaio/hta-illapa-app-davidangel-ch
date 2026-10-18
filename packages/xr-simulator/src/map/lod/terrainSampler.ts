import { type LocalFrame, tileAtLocal, tileKey, tileRect } from "./quadtree";
import type { TileSurface } from "./tileData";

export interface SamplerSource {
	/** CPU surface of a loaded tile. */
	surface(key: string): TileSurface | undefined;
	isDisplayed(key: string): boolean;
	rootZoom: number;
	maxZoom: number;
}

/**
 * Ground height (km, unexaggerated) for the fly clearance and picking: the finest loaded
 * tile, never below the surface actually drawn there (a coarser displayed tile, or the
 * parent's surface while a tile geomorphs in), so you cannot fly into a mountain that just
 * refined nor through the coarse surface still on screen.
 */
export class TerrainSampler {
	constructor(
		private readonly frame: LocalFrame,
		private readonly src: SamplerSource,
	) {}

	heightAt(x: number, z: number): number {
		let finest: number | null = null;
		let drawn: number | null = null;
		for (let zoom = this.src.maxZoom; zoom >= this.src.rootZoom; zoom--) {
			const t = tileAtLocal(this.frame, x, z, zoom);
			const key = tileKey(t);
			const s = this.src.surface(key);
			if (!s) continue;
			const r = tileRect(this.frame, t);
			const u = (x - r.west) / r.size;
			const v = (r.north - z) / r.size;
			if (finest === null) finest = s.fineAt(u, v);
			if (this.src.isDisplayed(key)) {
				drawn = Math.max(s.fineAt(u, v), s.coarseAt(u, v));
				break;
			}
		}
		return Math.max(finest ?? 0, drawn ?? 0) / 1000;
	}
}
