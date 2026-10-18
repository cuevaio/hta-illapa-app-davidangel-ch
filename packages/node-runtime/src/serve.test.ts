import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const evlog = vi.hoisted(() => {
	const logger = { error: vi.fn(), emit: vi.fn(), setLevel: vi.fn() };
	return {
		logger,
		createLogger: vi.fn((_fields: Record<string, unknown>) => logger),
	};
});
vi.mock("evlog", () => ({ createLogger: evlog.createLogger }));

beforeAll(() => {
	vi.stubEnv("DATABASE_URL", "mysql://user:secret@db.internal:3306/fierros");
	vi.stubEnv("PORT", "0");
});

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("scheduleWorker", () => {
	it("calls scheduled like a Cron Trigger and skips, without catching up, a tick that overlaps a busy run", async () => {
		vi.useFakeTimers({ now: new Date("2026-10-17T12:00:30.000Z") });
		const { scheduleWorker } = await import("./serve");
		const { env } = await import("./cloudflare-workers");
		const backgroundWork = Promise.withResolvers<void>();
		const scheduled = vi.fn<
			Parameters<typeof scheduleWorker>[0]["worker"]["scheduled"]
		>((_controller, _env, context) => {
			context.waitUntil(backgroundWork.promise);
		});
		const skippedTicks = () =>
			evlog.createLogger.mock.calls.filter(
				([fields]) => fields.lifecycle === "cron_skipped",
			).length;
		const [job] = scheduleWorker({
			worker: { scheduled },
			crons: ["* * * * *"],
		});

		await vi.advanceTimersByTimeAsync(30_000);
		expect(scheduled).toHaveBeenCalledOnce();
		expect(scheduled).toHaveBeenCalledWith(
			{
				cron: "* * * * *",
				scheduledTime: Date.parse("2026-10-17T12:01:00.000Z"),
				type: "scheduled",
				noRetry: expect.any(Function),
			},
			env,
			expect.objectContaining({
				waitUntil: expect.any(Function),
				passThroughOnException: expect.any(Function),
			}),
		);

		await vi.advanceTimersByTimeAsync(60_000);
		expect(scheduled).toHaveBeenCalledOnce();
		expect(skippedTicks()).toBe(1);
		expect(evlog.logger.setLevel).toHaveBeenCalledWith("warn");

		backgroundWork.resolve();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(scheduled).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(scheduled).toHaveBeenCalledTimes(2);
		expect(skippedTicks()).toBe(1);
		job?.stop();
	});
});

describe("serveWorker", () => {
	it("hands each request to fetch with the Node env and an execution context", async () => {
		const { serveWorker } = await import("./serve");
		const { env } = await import("./cloudflare-workers");
		const { waitForInvocations } = await import("./execution-context");
		const backgroundWork = vi.fn(async () => undefined);
		const fetchHandler = vi.fn<
			Parameters<typeof serveWorker>[0]["worker"]["fetch"]
		>(async (request, _env, context) => {
			context.waitUntil(backgroundWork());
			return new Response(`pong ${new URL(request.url).pathname}`);
		});
		const server = serveWorker({ worker: { fetch: fetchHandler } });
		await new Promise((resolve) => server.once("listening", resolve));
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Server is not listening on a TCP port");
		}

		const response = await fetch(
			`http://127.0.0.1:${address.port}/ping?probe=1`,
		);

		expect(await response.text()).toBe("pong /ping");
		expect(fetchHandler).toHaveBeenCalledWith(
			expect.any(Request),
			env,
			expect.objectContaining({ waitUntil: expect.any(Function) }),
		);
		await waitForInvocations();
		expect(backgroundWork).toHaveBeenCalledOnce();
		await new Promise((resolve) => server.close(resolve));
	});
});
