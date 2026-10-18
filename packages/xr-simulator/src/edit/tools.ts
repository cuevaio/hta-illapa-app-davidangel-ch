import type { PointerSample, Ray } from "../input/pointer";
import { isTap } from "../input/pointer";
import { MAX_EMITTERS } from "../solver/params";
import {
	type EditCommand,
	newCommandId,
	type SourceCommand,
	type Vec2,
	type WallCommand,
	type WallMaterial,
} from "./commands";
import { MAX_WALL_SEGMENTS, MAX_WALLS } from "./walls";

/** What tools render while the user aims; confirmed on release/tap/trigger. */
export interface EditPreview {
	wall(
		points: Vec2[] | null,
		halfWidth: number,
		height: number,
		material: WallMaterial,
		blocked: boolean,
	): void;
	source(pos: Vec2 | null, radius: number): void;
	/** Marks what the erase tool would remove. */
	highlight(target: WallCommand | SourceCommand | null): void;
}

/** Everything a tool needs from the app; tools never touch solver or terrain buffers. */
export interface ToolContext {
	/** Terrain-local (x, z) where the ray meets the terrain (CPU copy), or null. */
	pick(ray: Ray): Vec2 | null;
	dispatch(cmd: EditCommand): void;
	wallSettings(): { halfWidth: number; height: number; material: WallMaterial };
	/** False once the wall limit (MAX_WALLS) is reached. */
	canAddWall(): boolean;
	sourceSettings(): { radius: number; peakDischarge: number; volume: number };
	/** True when the flow under this wall is deeper than the allowed threshold. */
	wallBlocked(
		points: Vec2[],
		halfWidth: number,
		material: WallMaterial,
	): boolean;
	/** Source or wall the erase tool would remove at (x, z). */
	targetAt(x: number, z: number): WallCommand | SourceCommand | null;
	/** False once MAX_EMITTERS origins exist. */
	canAddSource(): boolean;
	/** Minimum spacing between wall vertices while dragging (m). */
	minSegment(): number;
	notify(message: string | null): void;
	/** Called after a command was confirmed (XR uses it for haptics). */
	confirmed(p: PointerSample): void;
	preview: EditPreview;
}

export interface Tool {
	onPointer(p: PointerSample): void;
	/** Drops any gesture in progress and clears previews. */
	cancel(): void;
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const polylineLength = (pts: Vec2[]) =>
	pts.slice(1).reduce((acc, q, k) => acc + dist(pts[k], q), 0);

/** Adds a debris-flow origin; its hydrograph starts when it is placed (or at t = 0 if paused before play). */
export class SourceTool implements Tool {
	constructor(private readonly ctx: ToolContext) {}

	onPointer(p: PointerSample): void {
		const hit = this.ctx.pick(p.ray);
		const { radius, peakDischarge, volume } = this.ctx.sourceSettings();
		this.ctx.preview.source(hit, radius);
		if (!hit || !isTap(p) || (p.kind !== "touch" && !p.toolGesture)) return;
		if (!this.ctx.canAddSource()) {
			this.ctx.notify(`Máximo ${MAX_EMITTERS} orígenes: borra o deshaz alguno`);
			return;
		}
		this.ctx.notify(null);
		this.ctx.dispatch({
			type: "source",
			id: newCommandId("source"),
			pos: hit,
			radius,
			peakDischarge,
			volume,
		});
		this.ctx.confirmed(p);
	}

	cancel(): void {
		this.ctx.preview.source(null, 0);
	}
}

/**
 * Draws a retaining wall. Mouse/trackpad/pen/XR accept both styles: press, drag (a segment
 * is added between consecutive pointer positions) and release; or click the start, then click
 * (or drag from) the end. Touch: tap the start, tap the end (one-finger drags orbit the camera).
 */
export class WallTool implements Tool {
	private points: Vec2[] = [];
	private activeId: string | null = null;
	/** Start point set by a click that did not drag; the next gesture continues from it. */
	private pendingStart: Vec2 | null = null;
	private continuing = false;

	constructor(private readonly ctx: ToolContext) {}

	onPointer(p: PointerSample): void {
		const hit = this.ctx.pick(p.ray);
		if (p.kind === "touch") this.touch(p, hit);
		else this.drag(p, hit);
	}

	private drag(p: PointerSample, hit: Vec2 | null): void {
		if (p.phase === "cancel") {
			this.cancel();
			return;
		}
		if (p.phase === "down" && p.toolGesture && hit) {
			this.activeId = p.id;
			this.continuing = this.pendingStart !== null;
			this.points = this.pendingStart ? [this.pendingStart] : [];
			this.points = this.withCursor(hit);
		} else if (p.id === this.activeId && p.pressed && hit) {
			const last = this.points[this.points.length - 1];
			if (
				dist(last, hit) >= this.ctx.minSegment() &&
				this.points.length < MAX_WALL_SEGMENTS + 1
			)
				this.points.push(hit);
		}
		let ghost: Vec2[] | null = hit ? [hit] : null;
		if (this.activeId) ghost = this.withCursor(hit);
		else if (this.pendingStart)
			ghost = hit ? [this.pendingStart, hit] : [this.pendingStart];
		this.show(ghost);
		if (p.phase === "up" && p.id === this.activeId) {
			this.activeId = null;
			const pts = this.withCursor(hit);
			this.points = [];
			if (!this.continuing && polylineLength(pts) < this.minLength()) {
				// A click that did not drag marks the start; the next click (or drag) sets the end.
				this.pendingStart = pts[0];
				this.show([pts[0]]);
				this.ctx.notify(
					"Haz clic en el extremo final del muro (o arrastra desde ahí)",
				);
				return;
			}
			this.pendingStart = null;
			this.continuing = false;
			this.commit(pts, p);
		}
	}

	private minLength(): number {
		return Math.max(this.ctx.wallSettings().halfWidth, this.ctx.minSegment());
	}

	private touch(p: PointerSample, hit: Vec2 | null): void {
		if (!isTap(p) || !hit) return;
		if (this.points.length === 0) {
			this.points = [hit];
			this.show([hit]);
			this.ctx.notify("Toca el extremo final del muro");
			return;
		}
		const pts: Vec2[] = [this.points[0], hit];
		this.points = [];
		this.commit(pts, p);
	}

	private withCursor(hit: Vec2 | null): Vec2[] {
		const last = this.points[this.points.length - 1];
		if (!last) return hit ? [hit] : [];
		return hit && dist(last, hit) > 0.5
			? [...this.points, hit]
			: [...this.points];
	}

	private show(points: Vec2[] | null): void {
		const { halfWidth, height, material } = this.ctx.wallSettings();
		this.ctx.preview.wall(
			points,
			halfWidth,
			height,
			material,
			points ? this.ctx.wallBlocked(points, halfWidth, material) : false,
		);
	}

	private commit(points: Vec2[], p: PointerSample): void {
		const { halfWidth, height, material } = this.ctx.wallSettings();
		this.ctx.preview.wall(null, 0, 0, material, false);
		if (polylineLength(points) < Math.max(halfWidth, this.ctx.minSegment())) {
			this.ctx.notify("Muro demasiado corto");
			return;
		}
		if (!this.ctx.canAddWall()) {
			this.ctx.notify(
				`Límite de ${MAX_WALLS} muros alcanzado: borra o deshaz alguno`,
			);
			return;
		}
		if (this.ctx.wallBlocked(points, halfWidth, material)) {
			this.ctx.notify(
				"No se puede colocar un muro donde el flujo es más profundo que el umbral",
			);
			return;
		}
		this.ctx.notify(null);
		this.ctx.dispatch({
			type: "wall",
			id: newCommandId("wall"),
			points,
			halfWidth,
			height,
			material,
		});
		this.ctx.confirmed(p);
	}

	cancel(): void {
		this.points = [];
		this.activeId = null;
		this.pendingStart = null;
		this.continuing = false;
		this.ctx.preview.wall(null, 0, 0, "earth", false);
	}
}

/** Removes the origin or wall under the pointer (as an `erase` command, so it can be undone). */
export class EraseTool implements Tool {
	constructor(private readonly ctx: ToolContext) {}

	onPointer(p: PointerSample): void {
		const hit = this.ctx.pick(p.ray);
		const target = hit ? this.ctx.targetAt(hit[0], hit[1]) : null;
		this.ctx.preview.highlight(target);
		if (!target || !isTap(p) || (p.kind !== "touch" && !p.toolGesture)) return;
		this.ctx.dispatch({
			type: "erase",
			id: newCommandId("erase"),
			target: target.id,
		});
		this.ctx.preview.highlight(null);
		this.ctx.confirmed(p);
	}

	cancel(): void {
		this.ctx.preview.highlight(null);
	}
}
