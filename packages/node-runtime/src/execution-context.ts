import { AsyncLocalStorage } from "node:async_hooks";
import { createLogger } from "evlog";

export interface WorkerExecutionContext {
	waitUntil(promise: Promise<unknown>): void;
	passThroughOnException(): void;
	readonly props: unknown;
}

export interface Invocation<Result> {
	result: Promise<Result>;
	finished: Promise<void>;
}

const invocationCleanups = new AsyncLocalStorage<
	Array<() => Promise<unknown>>
>();
const unfinishedInvocations = new Set<Promise<void>>();

export function reportFailure(error: unknown, fields: Record<string, unknown>) {
	const log = createLogger({ runtime: "node", ...fields });
	log.error(error instanceof Error ? error : String(error));
	log.emit();
}

// One fetch or scheduled event, as the Workers runtime sees it: it ends once
// the handler, every waitUntil promise and the cleanups registered while it
// ran have settled. Failures are reported instead of crashing the process.
export function runInvocation<Result>(
	fields: Record<string, unknown>,
	handler: (context: WorkerExecutionContext) => Result | Promise<Result>,
): Invocation<Result> {
	const pendingTasks = new Set<Promise<void>>();
	const cleanups: Array<() => Promise<unknown>> = [];
	const track = (task: Promise<unknown>, failedIn: string) => {
		const settledTask: Promise<void> = task
			.then(
				() => undefined,
				(error: unknown) => reportFailure(error, { ...fields, failedIn }),
			)
			.finally(() => pendingTasks.delete(settledTask));
		pendingTasks.add(settledTask);
	};
	const context: WorkerExecutionContext = {
		waitUntil: (promise) => track(promise, "waitUntil"),
		passThroughOnException() {},
		props: {},
	};
	const result = invocationCleanups.run(cleanups, async () => handler(context));
	track(result, "handler");
	const finished = (async () => {
		while (pendingTasks.size > 0) {
			await Promise.all(pendingTasks);
		}
		await Promise.all(
			cleanups.map((cleanup) =>
				cleanup().catch((error: unknown) =>
					reportFailure(error, { ...fields, failedIn: "cleanup" }),
				),
			),
		);
	})();
	unfinishedInvocations.add(finished);
	void finished.then(() => unfinishedInvocations.delete(finished));
	return { result, finished };
}

export function onInvocationFinished(cleanup: () => Promise<unknown>) {
	invocationCleanups.getStore()?.push(cleanup);
}

export async function waitForInvocations() {
	while (unfinishedInvocations.size > 0) {
		await Promise.all(unfinishedInvocations);
	}
}
