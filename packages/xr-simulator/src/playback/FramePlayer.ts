import type { FlowState } from "../solver/Solver";

/** One precomputed flow state. `resolution` may differ from the display grid (e.g. a high-res result). */
export interface Frame {
	simTime: number;
	resolution: number;
	state: FlowState;
	/** Volume tallies at that time, so the HUD balance stays right while replaying. */
	injectedVolume?: number;
	editRemovedVolume?: number;
}

/** Frames in increasing time, with a memory cap. */
export class FrameRecording {
	private frames: Frame[] = [];

	/** Memory cap; may be lowered for larger grids (applies on the next add). */
	constructor(public maxFrames = 240) {}

	get length(): number {
		return this.frames.length;
	}
	get start(): number {
		return this.frames[0]?.simTime ?? 0;
	}
	get end(): number {
		return this.frames[this.frames.length - 1]?.simTime ?? 0;
	}
	times(): number[] {
		return this.frames.map((f) => f.simTime);
	}
	at(index: number): Frame | undefined {
		return this.frames[index];
	}

	/** Appends a frame; frames that do not move time forward are ignored. */
	add(frame: Frame): void {
		if (this.frames.length && frame.simTime <= this.end) return;
		this.frames.push(frame);
		while (this.frames.length > Math.max(this.maxFrames, 2)) {
			// Halve the density but keep the first and the newest frame, so the whole run stays covered.
			const last = this.frames[this.frames.length - 1];
			this.frames = this.frames.filter((_, k) => k % 2 === 0);
			if (this.frames[this.frames.length - 1] !== last) this.frames.push(last);
		}
	}

	clear(): void {
		this.frames = [];
	}

	/** Index of the latest frame at or before t (the first frame for t before the start). */
	indexAt(t: number): number {
		let lo = 0;
		let hi = this.frames.length - 1;
		if (hi < 0) return -1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (this.frames[mid].simTime <= t + 1e-9) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	}
}

/** Timeline over a recording: play forward or backward, step frame by frame, scrub. */
export class FramePlayer {
	time = 0;
	playing = false;
	/** Simulated seconds per real second; negative plays backward. */
	speed = 10;

	constructor(readonly recording: FrameRecording) {
		this.time = recording.start;
	}

	play(): void {
		if (this.speed > 0 && this.time >= this.recording.end)
			this.time = this.recording.start;
		if (this.speed < 0 && this.time <= this.recording.start)
			this.time = this.recording.end;
		this.playing = this.recording.length > 1;
	}
	pause(): void {
		this.playing = false;
	}

	seek(t: number): void {
		this.time = Math.min(Math.max(t, this.recording.start), this.recording.end);
	}

	/** Moves to the next (+1) or previous (−1) frame, pausing playback. */
	step(direction: 1 | -1): void {
		this.playing = false;
		const k = this.recording.indexAt(this.time);
		const shown = this.recording.at(k);
		if (!shown) return;
		const target =
			direction > 0
				? this.recording.at(k + 1)
				: shown.simTime < this.time - 1e-9
					? shown
					: this.recording.at(k - 1);
		if (target) this.time = target.simTime;
	}

	/** Advances by `realSeconds` of wall time when playing; stops at either end. */
	tick(realSeconds: number): void {
		if (!this.playing) return;
		const t = this.time + this.speed * realSeconds;
		if (t >= this.recording.end || t <= this.recording.start)
			this.playing = false;
		this.seek(t);
	}

	current(): Frame | undefined {
		return this.recording.at(this.recording.indexAt(this.time));
	}
}
