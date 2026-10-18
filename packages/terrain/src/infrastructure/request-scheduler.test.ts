import { describe, expect, it } from "vitest";
import { RequestScheduler } from "./request-scheduler";

interface Pending {
	key: string;
	signal: AbortSignal;
	resolve: () => void;
}

function harness(maxConcurrent: number) {
	const started: Pending[] = [];
	const scheduler = new RequestScheduler({ maxConcurrent });
	const add = (key: string, priority: number) =>
		scheduler.schedule(key, priority, (signal) => {
			return new Promise<void>((resolve, reject) => {
				started.push({ key, signal, resolve });
				signal.addEventListener("abort", () =>
					reject(new DOMException("aborted", "AbortError")),
				);
			});
		});
	return { scheduler, started, add };
}

const flush = () => new Promise((request) => setTimeout(request, 0));

describe("RequestScheduler", () => {
	it("never runs more than maxConcurrent tasks", () => {
		const { scheduler, started, add } = harness(2);
		for (let index = 0; index < 5; index++) add(`t${index}`, index);
		expect(started).toHaveLength(2);
		expect(scheduler.stats).toEqual({ queued: 3, inFlight: 2 });
	});

	it("starts the most urgent (lowest priority value) tasks first", async () => {
		const { started, add } = harness(1);
		add("blocker", 0);
		add("late", 30);
		add("urgent", 10);
		add("middle", 20);
		started[0]?.resolve();
		await flush();
		expect(started.map((sample) => sample.key)).toEqual(["blocker", "urgent"]);
	});

	it("frees a slot when a task finishes", async () => {
		const { started, add } = harness(1);
		add("a", 0);
		add("b", 1);
		started[0]?.resolve();
		await flush();
		expect(started.map((sample) => sample.key)).toEqual(["a", "b"]);
	});

	it("deduplicates keys and updates the priority of queued tasks", async () => {
		const { started, add } = harness(1);
		add("blocker", 0);
		add("x", 50);
		add("y", 40);
		add("x", 10);
		started[0]?.resolve();
		await flush();
		expect(started.map((sample) => sample.key)).toEqual(["blocker", "x"]);
	});

	it("aborts in-flight and drops queued tasks that are no longer retained", async () => {
		const { scheduler, started, add } = harness(2);
		add("keep", 0);
		add("drop", 1);
		add("queued-drop", 2);
		add("queued-keep", 3);
		scheduler.retainOnly(new Set(["keep", "queued-keep"]));
		expect(
			started.find((sample) => sample.key === "drop")?.signal.aborted,
		).toBe(true);
		expect(
			started.find((sample) => sample.key === "keep")?.signal.aborted,
		).toBe(false);
		await flush();
		expect(started.map((sample) => sample.key)).toEqual([
			"keep",
			"drop",
			"queued-keep",
		]);
		expect(scheduler.stats).toEqual({ queued: 0, inFlight: 2 });
	});
});
