import { beforeEach, describe, expect, it, vi } from "vitest";

const evlog = vi.hoisted(() => {
	const logger = { error: vi.fn(), emit: vi.fn() };
	return { logger, createLogger: vi.fn(() => logger) };
});
vi.mock("evlog", () => ({ createLogger: evlog.createLogger }));

import {
	onInvocationFinished,
	runInvocation,
	waitForInvocations,
} from "./execution-context";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("runInvocation", () => {
	it("reports a rejected waitUntil promise through evlog without failing the invocation", async () => {
		const failure = new Error("drain failed");
		const { result, finished } = runInvocation(
			{ trigger: "cron:*/5 * * * *" },
			(context) => {
				context.waitUntil(Promise.reject(failure));
				return "scheduled";
			},
		);

		await expect(result).resolves.toBe("scheduled");
		await expect(finished).resolves.toBeUndefined();
		expect(evlog.createLogger).toHaveBeenCalledWith({
			runtime: "node",
			trigger: "cron:*/5 * * * *",
			failedIn: "waitUntil",
		});
		expect(evlog.logger.error).toHaveBeenCalledWith(failure);
		expect(evlog.logger.emit).toHaveBeenCalledOnce();
	});

	it("reports a throwing handler and rejects its result", async () => {
		const failure = new Error("handler failed");
		const { result, finished } = runInvocation(
			{ trigger: "fetch", method: "POST", path: "/run" },
			() => {
				throw failure;
			},
		);

		await expect(result).rejects.toBe(failure);
		await finished;
		expect(evlog.createLogger).toHaveBeenCalledWith({
			runtime: "node",
			trigger: "fetch",
			method: "POST",
			path: "/run",
			failedIn: "handler",
		});
		expect(evlog.logger.error).toHaveBeenCalledWith(failure);
	});

	it("finishes after waitUntil work added while it ran, then runs its cleanups", async () => {
		const settledSteps: string[] = [];
		const firstTask = Promise.withResolvers<void>();
		const secondTask = Promise.withResolvers<void>();
		const { finished } = runInvocation({ trigger: "fetch" }, (context) => {
			onInvocationFinished(async () => {
				settledSteps.push("cleanup");
			});
			context.waitUntil(
				firstTask.promise.then(() => {
					settledSteps.push("first task");
					context.waitUntil(
						secondTask.promise.then(() => {
							settledSteps.push("second task");
						}),
					);
				}),
			);
		});
		let isFinished = false;
		void finished.then(() => {
			isFinished = true;
		});

		firstTask.resolve();
		await firstTask.promise;
		await Promise.resolve();
		expect(isFinished).toBe(false);
		secondTask.resolve();
		await finished;

		expect(settledSteps).toEqual(["first task", "second task", "cleanup"]);
	});

	it("only registers cleanups from inside an invocation", async () => {
		const cleanup = vi.fn(async () => undefined);
		onInvocationFinished(cleanup);
		await runInvocation({ trigger: "fetch" }, () => undefined).finished;
		expect(cleanup).not.toHaveBeenCalled();
	});
});

describe("waitForInvocations", () => {
	it("resolves once every running invocation has finished", async () => {
		const backgroundWork = Promise.withResolvers<void>();
		runInvocation({ trigger: "fetch" }, (context) => {
			context.waitUntil(backgroundWork.promise);
		});
		let isDrained = false;
		const drained = waitForInvocations().then(() => {
			isDrained = true;
		});

		await Promise.resolve();
		expect(isDrained).toBe(false);
		backgroundWork.resolve();
		await drained;
		expect(isDrained).toBe(true);
	});
});
