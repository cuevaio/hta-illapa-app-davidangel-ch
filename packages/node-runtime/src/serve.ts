import { setTimeout as delay } from "node:timers/promises";
import { type ServerType, serve } from "@hono/node-server";
import { Cron } from "croner";
import { createLogger } from "evlog";

import { env, port } from "./cloudflare-workers";
import {
	CRON_TIMEZONE,
	HTTP_KEEP_ALIVE_TIMEOUT_MS,
	SHUTDOWN_SIGNALS,
	SHUTDOWN_TIMEOUT_MS,
} from "./constants";
import {
	runInvocation,
	type WorkerExecutionContext,
	waitForInvocations,
} from "./execution-context";

export interface FetchWorker {
	fetch(
		request: Request,
		env: unknown,
		context: WorkerExecutionContext,
	): Response | Promise<Response>;
}

export interface ScheduledWorker {
	scheduled(
		controller: ScheduledController,
		env: unknown,
		context: WorkerExecutionContext,
	): unknown;
}

interface ServeWorkerOptions {
	worker: FetchWorker;
}

interface ScheduleWorkerOptions {
	worker: ScheduledWorker;
	crons: string[];
}

interface NodeScheduledController extends ScheduledController {
	readonly type: "scheduled";
}

const servers = new Set<ServerType>();
const cronJobs = new Set<Cron>();
let isShutdownHandled = false;

export function serveWorker({ worker }: ServeWorkerOptions): ServerType {
	const server = serve(
		{
			port,
			serverOptions: { keepAliveTimeout: HTTP_KEEP_ALIVE_TIMEOUT_MS },
			fetch: (request, { outgoing }) =>
				runInvocation(
					{
						trigger: "fetch",
						method: request.method,
						path: new URL(request.url).pathname,
					},
					(context) => {
						// The invocation lasts until the response is fully sent, as on
						// Workers, so its database connection outlives a streamed body.
						context.waitUntil(
							new Promise((resolve) => outgoing.once("close", resolve)),
						);
						return worker.fetch(request, env, context);
					},
				).result,
		},
		(address) =>
			createLogger({
				runtime: "node",
				lifecycle: "listening",
				port: address.port,
			}).emit(),
	);
	servers.add(server);
	handleShutdownSignals();
	return server;
}

export function scheduleWorker({
	worker,
	crons,
}: ScheduleWorkerOptions): Cron[] {
	const jobs = crons.map((cron) => {
		// Overlap guard kept here rather than croner's `protect`, which re-runs a
		// skipped tick off-schedule as soon as the previous run frees up.
		let isRunning = false;
		return new Cron(cron, { timezone: CRON_TIMEZONE }, async () => {
			if (isRunning) {
				const log = createLogger({
					runtime: "node",
					lifecycle: "cron_skipped",
					cron,
					reason: "previous run still in progress",
				});
				log.setLevel("warn");
				log.emit();
				return;
			}
			isRunning = true;
			const controller: NodeScheduledController = {
				cron,
				scheduledTime: Date.now(),
				type: "scheduled",
				noRetry() {},
			};
			try {
				await runInvocation({ trigger: `cron:${cron}` }, (context) =>
					worker.scheduled(controller, env, context),
				).finished;
			} finally {
				isRunning = false;
			}
		});
	});
	for (const job of jobs) {
		cronJobs.add(job);
	}
	createLogger({
		runtime: "node",
		lifecycle: "scheduled",
		crons: jobs.map((job) => ({
			cron: job.getPattern(),
			nextRun: job.nextRun()?.toISOString(),
		})),
	}).emit();
	handleShutdownSignals();
	return jobs;
}

function handleShutdownSignals() {
	if (isShutdownHandled) {
		return;
	}
	isShutdownHandled = true;
	for (const signal of SHUTDOWN_SIGNALS) {
		process.once(signal, () => void shutDown(signal));
	}
}

async function shutDown(signal: NodeJS.Signals) {
	for (const job of cronJobs) {
		job.stop();
	}
	const drained = await Promise.race([
		Promise.all([
			...Array.from(
				servers,
				(server) => new Promise((resolve) => server.close(resolve)),
			),
			waitForInvocations(),
		]).then(() => true),
		delay(SHUTDOWN_TIMEOUT_MS, false),
	]);
	const log = createLogger({
		runtime: "node",
		lifecycle: "shutdown",
		signal,
		drained,
	});
	if (!drained) {
		log.setLevel("warn");
	}
	log.emit();
	process.exit(drained ? 0 : 1);
}
