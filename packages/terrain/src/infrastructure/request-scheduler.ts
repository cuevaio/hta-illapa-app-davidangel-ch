interface Job {
	key: string;
	priority: number;
	task: (signal: AbortSignal) => Promise<void>;
}

interface Running {
	controller: AbortController;
}

export interface SchedulerStats {
	queued: number;
	inFlight: number;
}

/**
 * Priority queue of cancellable async tasks with bounded concurrency.
 * Lower priority values run first; keys are deduplicated.
 */
export class RequestScheduler {
	private readonly queue = new Map<string, Job>();
	private readonly running = new Map<string, Running>();

	constructor(private readonly options: { maxConcurrent: number }) {}

	get stats(): SchedulerStats {
		return { queued: this.queue.size, inFlight: this.running.size };
	}

	isPending(key: string): boolean {
		return this.queue.has(key) || this.running.has(key);
	}

	schedule(key: string, priority: number, task: Job["task"]): void {
		if (this.running.has(key)) return;
		const existing = this.queue.get(key);
		if (existing) {
			existing.priority = priority;
			existing.task = task;
		} else {
			this.queue.set(key, { key, priority, task });
		}
		this.pump();
	}

	/** Drops queued jobs and aborts running jobs whose key is not in `keys`. */
	retainOnly(keys: ReadonlySet<string>): void {
		for (const key of [...this.queue.keys()]) {
			if (!keys.has(key)) this.queue.delete(key);
		}
		for (const [key, runningJob] of [...this.running]) {
			if (!keys.has(key)) {
				this.running.delete(key);
				runningJob.controller.abort();
			}
		}
		this.pump();
	}

	cancelAll(): void {
		this.retainOnly(new Set());
	}

	private pump(): void {
		while (
			this.running.size < this.options.maxConcurrent &&
			this.queue.size > 0
		) {
			let next: Job | undefined;
			for (const job of this.queue.values()) {
				if (!next || job.priority < next.priority) next = job;
			}
			if (!next) return;
			this.queue.delete(next.key);
			this.start(next);
		}
	}

	private start(job: Job): void {
		const runningJob: Running = { controller: new AbortController() };
		this.running.set(job.key, runningJob);
		const finish = () => {
			// A retained-out job was already removed; never free its slot twice.
			if (this.running.get(job.key) === runningJob) {
				this.running.delete(job.key);
				this.pump();
			}
		};
		job.task(runningJob.controller.signal).then(finish, finish);
	}
}
