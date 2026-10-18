import { describe, expect, it } from "vitest";
import { FpsGovernor, type GovernorAction } from "../src/platform/governor";

function run(g: FpsGovernor, fps: number, seconds: number): GovernorAction[] {
	const out: GovernorAction[] = [];
	const ms = 1000 / fps;
	for (let t = 0; t < seconds * 1000; t += ms) {
		const a = g.frame(ms);
		if (a !== "none") out.push(a);
	}
	return out;
}

describe("FpsGovernor", () => {
	it("does nothing while the frame rate meets the target", () => {
		expect(run(new FpsGovernor({ targetFps: 60 }), 60, 30)).toEqual([]);
		expect(run(new FpsGovernor({ targetFps: 72 }), 65, 30)).toEqual([]);
	});

	it("escalates render scale, then substeps, then profile when it stays slow", () => {
		const g = new FpsGovernor({ targetFps: 60 });
		const actions = run(g, 30, 25);
		expect(actions.slice(0, 3)).toEqual([
			"reduce-render-scale",
			"reduce-substeps",
			"step-down-profile",
		]);
		// Still slow: keep stepping the profile down (the app stops at the lowest one).
		expect(actions.slice(3).every((a) => a === "step-down-profile")).toBe(true);
		expect(actions.length).toBeGreaterThan(3);
	});

	it("ignores short dips", () => {
		const g = new FpsGovernor({ targetFps: 60 });
		expect([...run(g, 30, 2), ...run(g, 60, 5), ...run(g, 30, 2)]).toEqual([]);
	});

	it("starts over after reset", () => {
		const g = new FpsGovernor({ targetFps: 60 });
		run(g, 20, 6);
		g.reset();
		expect(g.level).toBe(0);
		expect(run(g, 20, 6)[0]).toBe("reduce-render-scale");
	});
});
