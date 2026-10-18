import { describe, expect, it } from "vitest";
import {
	type Frame,
	FramePlayer,
	FrameRecording,
} from "../src/playback/FramePlayer";

const frame = (t: number): Frame => ({
	simTime: t,
	resolution: 1,
	state: {
		h: Float32Array.of(t),
		hu: Float32Array.of(0),
		hv: Float32Array.of(0),
	},
});

function recording(times: number[], max = 100) {
	const r = new FrameRecording(max);
	times.forEach((t) => {
		r.add(frame(t));
	});
	return r;
}

describe("FrameRecording", () => {
	it("keeps frames in time order and finds the latest frame at or before t", () => {
		const r = recording([0, 5, 10, 15]);
		expect(r.length).toBe(4);
		expect(r.start).toBe(0);
		expect(r.end).toBe(15);
		expect(r.indexAt(-1)).toBe(0);
		expect(r.indexAt(7.5)).toBe(1);
		expect(r.indexAt(10)).toBe(2);
		expect(r.indexAt(99)).toBe(3);
	});
	it("ignores frames that do not move time forward (e.g. a paused simulation)", () => {
		const r = recording([0, 5, 5, 3, 10]);
		expect(r.times()).toEqual([0, 5, 10]);
	});
	it("keeps every other frame when full, so it still covers the whole run", () => {
		const r = recording([0, 1, 2, 3, 4, 5, 6], 4);
		expect(r.length).toBeLessThanOrEqual(4);
		expect(r.start).toBe(0);
		expect(r.end).toBe(6);
	});
});

describe("FrameRecording capacity", () => {
	it("can lower its frame cap (e.g. for a larger grid) and thins out to it", () => {
		const r = recording([0, 1, 2, 3, 4, 5, 6, 7]);
		r.maxFrames = 3;
		r.add(frame(8));
		expect(r.length).toBeLessThanOrEqual(3);
		expect(r.end).toBe(8);
	});
});

describe("FramePlayer", () => {
	it("plays forward at the chosen speed and stops at the last frame", () => {
		const p = new FramePlayer(recording([0, 5, 10, 15]));
		p.speed = 10;
		p.play();
		p.tick(0.6); // 6 simulated seconds
		expect(p.time).toBeCloseTo(6);
		expect(p.current()?.simTime).toBe(5);
		p.tick(10);
		expect(p.time).toBe(15);
		expect(p.playing).toBe(false);
	});
	it("plays backward with a negative speed and stops at the first frame", () => {
		const p = new FramePlayer(recording([0, 5, 10]));
		p.seek(10);
		p.speed = -10;
		p.play();
		p.tick(0.7);
		expect(p.time).toBeCloseTo(3);
		expect(p.current()?.simTime).toBe(0);
		p.tick(5);
		expect(p.time).toBe(0);
		expect(p.playing).toBe(false);
	});
	it("steps frame by frame in both directions and clamps seeks to the recording", () => {
		const p = new FramePlayer(recording([0, 5, 10]));
		p.step(1);
		expect(p.time).toBe(5);
		p.step(1);
		p.step(1);
		expect(p.time).toBe(10);
		p.step(-1);
		expect(p.time).toBe(5);
		p.seek(7);
		p.step(-1);
		expect(p.time).toBe(5); // from between frames, back goes to the frame shown
		p.seek(-20);
		expect(p.time).toBe(0);
		p.seek(1e9);
		expect(p.time).toBe(10);
	});
	it("playing from the end restarts from the beginning", () => {
		const p = new FramePlayer(recording([0, 5]));
		p.seek(5);
		p.speed = 1;
		p.play();
		expect(p.time).toBe(0);
	});
});
