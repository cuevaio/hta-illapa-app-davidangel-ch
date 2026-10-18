/**
 * At most `perFrame` acquisitions per frame (GPU texture uploads), so a burst of arriving
 * tiles never spikes one frame. `tick()` once per rendered frame; waiters are FIFO.
 */
export class FrameBudget {
	private available = 0;
	private readonly waiters: {
		resolve: () => void;
		reject: (e: unknown) => void;
		signal?: AbortSignal;
		onAbort?: () => void;
	}[] = [];

	constructor(private readonly perFrame: number) {}

	get waiting(): number {
		return this.waiters.length;
	}

	acquire(signal?: AbortSignal): Promise<void> {
		if (signal?.aborted)
			return Promise.reject(new DOMException("Aborted", "AbortError"));
		if (this.available > 0 && this.waiters.length === 0) {
			this.available--;
			return Promise.resolve();
		}
		return new Promise((resolve, reject) => {
			const w: (typeof this.waiters)[number] = { resolve, reject, signal };
			if (signal) {
				w.onAbort = () => {
					const i = this.waiters.indexOf(w);
					if (i >= 0) this.waiters.splice(i, 1);
					reject(new DOMException("Aborted", "AbortError"));
				};
				signal.addEventListener("abort", w.onAbort, { once: true });
			}
			this.waiters.push(w);
		});
	}

	tick(): void {
		this.available = this.perFrame;
		while (this.available > 0 && this.waiters.length) {
			const w = this.waiters.shift()!;
			if (w.onAbort) w.signal?.removeEventListener("abort", w.onAbort);
			this.available--;
			w.resolve();
		}
	}
}
