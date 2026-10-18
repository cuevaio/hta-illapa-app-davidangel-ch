import { describe, expect, it } from "vitest";
import {
	type Bounds,
	easeInOut,
	FLY,
	type Vec3,
	ZOOM,
	ZoomTween,
	zoomTarget,
} from "../../src/map/flight";
import {
	EXAGGERATION,
	exaggerationLabel,
	overviewButtons,
} from "../../src/map/overviewState";
import { applyRig, composeRig, type Rig, yawAbout } from "../../src/map/rig";

const close = (a: number[], b: number[], d = 6) =>
	a.forEach((v, i) => {
		expect(v).toBeCloseTo(b[i], d);
	});
const wide: Bounds = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 };
const flat = () => 0;

describe('zoomTarget (trigger / double-click "zoom hacia ahí")', () => {
	it("ends at ZOOM.fraction of the current distance from the hit, on the eye→hit line", () => {
		const end = zoomTarget([0, 100, 0], [0, 0, 100], flat, wide);
		expect(ZOOM.fraction).toBe(0.35);
		close(end, [0, 35, 65]);
	});
	it("repeated zooms keep getting closer", () => {
		let eye: Vec3 = [0, 100, 0];
		const hit: Vec3 = [0, 0, 100];
		const d = (p: Vec3) =>
			Math.hypot(p[0] - hit[0], p[1] - hit[1], p[2] - hit[2]);
		for (let i = 0; i < 3; i++) {
			const next = zoomTarget(eye, hit, flat, wide);
			expect(d(next)).toBeLessThan(d(eye));
			eye = next;
		}
	});
	it("never ends closer than FLY.clearance above the drawn ground", () => {
		// Grazing ray over a ridge: the straight end point would be under the relief.
		const ridge = (x: number) => (x > 50 ? 30 : 0);
		const end = zoomTarget(
			[0, 1, 0],
			[100, 30, 0],
			(x) => ridge(x),
			wide,
			0.35,
		);
		expect(end[1]).toBeGreaterThanOrEqual(30 + FLY.clearance - 1e-9);
		const low = zoomTarget([0, 0.31, 0], [0.01, 0, 0], flat, wide);
		expect(low[1]).toBeGreaterThanOrEqual(FLY.clearance);
	});
	it("stays inside the bounds", () => {
		const b: Bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
		const end = zoomTarget([0, 100, 0], [500, 0, 0], flat, b);
		expect(end[0]).toBe(10);
	});
});

describe("ZoomTween (ease-in-out ~0.8 s)", () => {
	it("eases in and out", () => {
		expect(easeInOut(0)).toBe(0);
		expect(easeInOut(1)).toBe(1);
		expect(easeInOut(0.5)).toBeCloseTo(0.5);
		expect(easeInOut(0.1)).toBeLessThan(0.1);
		expect(easeInOut(0.9)).toBeGreaterThan(0.9);
	});
	it("returns per-step translations that add up to the target over ZOOM.duration", () => {
		expect(ZOOM.duration).toBe(0.8);
		const tw = new ZoomTween([0, 10, 0], [0, 0, 10]);
		const sum: Vec3 = [0, 0, 0];
		let first = 0;
		for (let i = 0; i < 10; i++) {
			const s = tw.step(0.1);
			if (i === 0) first = Math.hypot(...s);
			sum[0] += s[0];
			sum[1] += s[1];
			sum[2] += s[2];
		}
		close(sum, [0, -10, 10]);
		expect(tw.done).toBe(true);
		// Eased: the first step is slow.
		expect(first).toBeLessThan(Math.hypot(10, 10) / 8);
		close(tw.step(0.1), [0, 0, 0]);
	});
	it("cancel stops it (stick input or grip grab)", () => {
		const tw = new ZoomTween([0, 10, 0], [0, 0, 10]);
		tw.step(0.2);
		tw.cancel();
		expect(tw.done).toBe(true);
		close(tw.step(0.1), [0, 0, 0]);
	});
});

describe("rig moves (stick flight, grip turn, snap turn)", () => {
	it("yaw about a pivot keeps the pivot fixed and turns other points", () => {
		const m = yawAbout(Math.PI / 2, [1, 2, 3]);
		close(applyRig(m, [1, 2, 3]), [1, 2, 3]);
		close(applyRig(m, [1, 2, 4]), [2, 2, 3]);
	});
	it("composes moves in order", () => {
		const r: Rig = composeRig(
			{ yaw: 0, t: [1, 0, 0] },
			{ yaw: 0, t: [0, 2, 0] },
		);
		close(r.t, [1, 2, 0]);
	});
});

describe("overview state", () => {
	it("vertical exaggeration defaults to ×3 with a 1–10 slider, step 0.5", () => {
		expect(EXAGGERATION).toEqual({ default: 3, min: 1, max: 10, step: 0.5 });
		expect(exaggerationLabel(3)).toBe("×3");
		expect(exaggerationLabel(2.5)).toBe("×2,5");
	});
	it('"Simular aquí" and "Ir al simulador" stay disabled until the simulator is ready (A1)', () => {
		const base = {
			loaded: true,
			picked: true,
			busy: false,
			simulatorReady: false,
		};
		expect(overviewButtons(base)).toEqual({ simulate: false, skip: false });
		expect(overviewButtons({ ...base, simulatorReady: true })).toEqual({
			simulate: true,
			skip: true,
		});
		expect(
			overviewButtons({ ...base, simulatorReady: true, picked: false }),
		).toEqual({ simulate: false, skip: true });
		expect(
			overviewButtons({ ...base, simulatorReady: true, busy: true }),
		).toEqual({ simulate: false, skip: false });
	});
});
