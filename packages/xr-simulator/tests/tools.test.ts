import { describe, expect, it } from "vitest";
import type { EditCommand, Vec2, WallCommand } from "../src/edit/commands";
import {
	EraseTool,
	SourceTool,
	type ToolContext,
	WallTool,
} from "../src/edit/tools";
import type {
	PointerKind,
	PointerPhase,
	PointerSample,
} from "../src/input/pointer";

function setup(
	opts: {
		blocked?: boolean;
		walls?: WallCommand[];
		full?: boolean;
		sourcesFull?: boolean;
	} = {},
) {
	const dispatched: EditCommand[] = [];
	const notices: (string | null)[] = [];
	const ghosts: (Vec2[] | null)[] = [];
	const ctx: ToolContext = {
		// Tests encode the hit point in the ray origin.
		pick: (ray) => [ray.origin[0], ray.origin[2]],
		dispatch: (c) => dispatched.push(c),
		wallSettings: () => ({
			halfWidth: 10,
			height: 5,
			material: "concrete" as const,
		}),
		canAddWall: () => !opts.full,
		sourceSettings: () => ({ radius: 25, peakDischarge: 100, volume: 5000 }),
		wallBlocked: () => opts.blocked ?? false,
		targetAt: (x, z) =>
			(opts.walls ?? []).find(
				(w) =>
					Math.abs(z - w.points[0][1]) < w.halfWidth &&
					x >= w.points[0][0] &&
					x <= w.points[1][0],
			) ?? null,
		canAddSource: () => !opts.sourcesFull,
		minSegment: () => 10,
		notify: (m) => notices.push(m),
		confirmed: () => {},
		preview: {
			wall: (p) => ghosts.push(p),
			source: () => {},
			highlight: () => {},
		},
	};
	return { ctx, dispatched, notices, ghosts };
}

function sample(
	kind: PointerKind,
	phase: PointerPhase,
	x: number,
	z: number,
	travel = 0,
	toolGesture = kind !== "touch",
): PointerSample {
	return {
		id: `${kind}-1`,
		kind,
		phase,
		primary: true,
		travel,
		toolGesture,
		pressed:
			phase === "down" || (phase === "move" && travel >= 0 && toolGesture),
		ray: { origin: [x, 100, z], direction: [0, -1, 0] },
	};
}

describe("SourceTool", () => {
	it("places the source on click and ignores touch drags", () => {
		const { ctx, dispatched } = setup();
		const tool = new SourceTool(ctx);
		tool.onPointer(sample("mouse", "down", 50, 60));
		tool.onPointer(sample("mouse", "up", 50, 60, 2));
		expect(dispatched).toMatchObject([
			{
				type: "source",
				pos: [50, 60],
				radius: 25,
				peakDischarge: 100,
				volume: 5000,
			},
		]);
		tool.onPointer(sample("touch", "up", 10, 10, 60));
		expect(dispatched).toHaveLength(1);
		tool.onPointer(sample("touch", "up", 10, 10, 3));
		expect(dispatched).toHaveLength(2);
	});

	it("adds a new source on every click, up to the limit", () => {
		const { ctx, dispatched } = setup();
		const tool = new SourceTool(ctx);
		for (const x of [10, 60]) {
			tool.onPointer(sample("mouse", "down", x, 5));
			tool.onPointer(sample("mouse", "up", x, 5));
		}
		expect(dispatched.map((c) => c.type)).toEqual(["source", "source"]);
		expect(dispatched[0].id).not.toBe(dispatched[1].id);
		const full = setup({ sourcesFull: true });
		const t2 = new SourceTool(full.ctx);
		t2.onPointer(sample("mouse", "down", 10, 5));
		t2.onPointer(sample("mouse", "up", 10, 5));
		expect(full.dispatched).toHaveLength(0);
		expect(full.notices.at(-1)).toMatch(/orígenes/);
	});

	it("ignores mouse gestures not claimed for tools (e.g. right-button orbit)", () => {
		const { ctx, dispatched } = setup();
		new SourceTool(ctx).onPointer(sample("mouse", "up", 50, 60, 2, false));
		expect(dispatched).toHaveLength(0);
	});
});

describe("WallTool", () => {
	it("turns a mouse drag into one polyline wall, adding a segment between consecutive positions", () => {
		const { ctx, dispatched } = setup();
		const tool = new WallTool(ctx);
		tool.onPointer(sample("mouse", "down", 0, 0));
		for (const x of [4, 12, 25, 31, 47])
			tool.onPointer({ ...sample("mouse", "move", x, 0, x), pressed: true });
		tool.onPointer(sample("mouse", "up", 50, 0, 50));
		expect(dispatched).toHaveLength(1);
		const w = dispatched[0] as WallCommand;
		expect(w).toMatchObject({
			type: "wall",
			halfWidth: 10,
			height: 5,
			material: "concrete",
		});
		expect(w.points[0]).toEqual([0, 0]);
		expect(w.points[w.points.length - 1]).toEqual([50, 0]);
		expect(w.points.length).toBeGreaterThanOrEqual(4);
	});

	it("refuses walls over deep flow and too-short walls", () => {
		const blocked = setup({ blocked: true });
		const t1 = new WallTool(blocked.ctx);
		t1.onPointer(sample("mouse", "down", 0, 0));
		t1.onPointer(sample("mouse", "up", 80, 0, 80));
		expect(blocked.dispatched).toHaveLength(0);
		expect(blocked.notices.at(-1)).toMatch(/umbral/);

		const short = setup();
		const t2 = new WallTool(short.ctx);
		t2.onPointer(sample("mouse", "down", 0, 0));
		t2.onPointer(sample("mouse", "up", 3, 0, 3));
		expect(short.dispatched).toHaveLength(0);
	});

	it("refuses walls beyond the wall limit", () => {
		const { ctx, dispatched, notices } = setup({ full: true });
		const tool = new WallTool(ctx);
		tool.onPointer(sample("mouse", "down", 0, 0));
		tool.onPointer(sample("mouse", "up", 80, 0, 80));
		expect(dispatched).toHaveLength(0);
		expect(notices.at(-1)).toMatch(/Límite/);
	});

	it("also builds a wall from two clicks (start, end) with a mouse or trackpad", () => {
		const { ctx, dispatched, notices, ghosts } = setup();
		const tool = new WallTool(ctx);
		tool.onPointer(sample("mouse", "down", 10, 10));
		tool.onPointer(sample("mouse", "up", 10, 10, 0));
		expect(dispatched).toHaveLength(0);
		expect(notices.at(-1)).toMatch(/final/);
		// Hovering shows the ghost from the start point to the cursor.
		tool.onPointer({
			...sample("mouse", "move", 60, 10),
			pressed: false,
			toolGesture: false,
		});
		expect(ghosts.at(-1)).toEqual([
			[10, 10],
			[60, 10],
		]);
		tool.onPointer(sample("mouse", "down", 90, 10));
		tool.onPointer(sample("mouse", "up", 90, 10, 0));
		expect(dispatched).toMatchObject([
			{
				type: "wall",
				points: [
					[10, 10],
					[90, 10],
				],
			},
		]);
	});

	it("continues a drag from a clicked start point", () => {
		const { ctx, dispatched } = setup();
		const tool = new WallTool(ctx);
		tool.onPointer(sample("mouse", "down", 0, 0));
		tool.onPointer(sample("mouse", "up", 0, 0, 0));
		tool.onPointer(sample("mouse", "down", 40, 0));
		tool.onPointer({ ...sample("mouse", "move", 60, 20, 20), pressed: true });
		tool.onPointer(sample("mouse", "up", 80, 40, 40));
		const w = dispatched[0] as WallCommand;
		expect(w.points[0]).toEqual([0, 0]);
		expect(w.points[1]).toEqual([40, 0]);
		expect(w.points.at(-1)).toEqual([80, 40]);
	});

	it("XR trigger taps work as start and end clicks", () => {
		const { ctx, dispatched } = setup();
		const tool = new WallTool(ctx);
		for (const x of [0, 70]) {
			tool.onPointer(sample("xr-controller", "down", x, 5));
			tool.onPointer(sample("xr-controller", "up", x, 5));
		}
		expect(dispatched).toMatchObject([
			{
				type: "wall",
				points: [
					[0, 5],
					[70, 5],
				],
			},
		]);
	});

	it("builds a wall from two taps on touch", () => {
		const { ctx, dispatched } = setup();
		const tool = new WallTool(ctx);
		tool.onPointer(sample("touch", "up", 10, 10, 2));
		expect(dispatched).toHaveLength(0);
		tool.onPointer(sample("touch", "up", 10, 90, 60)); // a drag orbits the camera: ignored
		tool.onPointer(sample("touch", "up", 70, 10, 1));
		expect(dispatched).toMatchObject([
			{
				type: "wall",
				points: [
					[10, 10],
					[70, 10],
				],
			},
		]);
	});

	it("cancel drops the gesture and the ghost", () => {
		const { ctx, dispatched, ghosts } = setup();
		const tool = new WallTool(ctx);
		tool.onPointer(sample("mouse", "down", 0, 0));
		tool.cancel();
		expect(ghosts.at(-1)).toBeNull();
		tool.onPointer(sample("mouse", "up", 80, 0, 80));
		expect(dispatched).toHaveLength(0);
		// A clicked start point is dropped too: the next click starts a new wall.
		tool.onPointer(sample("mouse", "down", 0, 0));
		tool.onPointer(sample("mouse", "up", 0, 0, 0));
		tool.cancel();
		tool.onPointer(sample("mouse", "down", 90, 0));
		tool.onPointer(sample("mouse", "up", 90, 0, 0));
		expect(dispatched).toHaveLength(0);
	});
});

describe("EraseTool on sources", () => {
	it("erases the source under the pointer", () => {
		const { ctx, dispatched } = setup();
		ctx.targetAt = () => ({
			type: "source",
			id: "s9",
			pos: [5, 5],
			radius: 20,
			peakDischarge: 1,
			volume: 1,
		});
		const tool = new EraseTool(ctx);
		tool.onPointer(sample("mouse", "up", 5, 5, 1));
		expect(dispatched).toMatchObject([{ type: "erase", target: "s9" }]);
	});
});

describe("EraseTool", () => {
	it("erases the wall under the pointer", () => {
		const wall: WallCommand = {
			type: "wall",
			id: "w1",
			points: [
				[0, 50],
				[100, 50],
			],
			halfWidth: 10,
			height: 5,
			material: "earth",
		};
		const { ctx, dispatched } = setup({ walls: [wall] });
		const tool = new EraseTool(ctx);
		tool.onPointer(sample("mouse", "up", 50, 90, 1));
		expect(dispatched).toHaveLength(0);
		tool.onPointer(sample("mouse", "up", 50, 52, 1));
		expect(dispatched).toMatchObject([{ type: "erase", target: "w1" }]);
	});
});
