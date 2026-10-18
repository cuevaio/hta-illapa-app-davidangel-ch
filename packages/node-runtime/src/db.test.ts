import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const logger = { error: vi.fn(), emit: vi.fn() };
	const client = { end: vi.fn(async () => undefined), on: vi.fn() };
	return {
		logger,
		client,
		createLogger: vi.fn(() => logger),
		openDatabase: vi.fn(async () => ({ $client: client })),
	};
});
vi.mock("evlog", () => ({ createLogger: mocks.createLogger }));
vi.mock("@hack-the-andes-project/db/index", () => ({
	createDb: mocks.openDatabase,
}));

import { createDb } from "./db";
import { runInvocation } from "./execution-context";

const connectionConfig = {
	host: "db.internal",
	port: 3306,
	user: "user",
	password: "secret",
	database: "fierros",
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("Node createDb", () => {
	it("closes the request connection once its invocation, waitUntil work included, has finished", async () => {
		const backgroundWork = Promise.withResolvers<void>();
		const { result, finished } = runInvocation(
			{ trigger: "fetch" },
			async (context) => {
				await createDb(connectionConfig);
				context.waitUntil(backgroundWork.promise);
			},
		);

		await result;
		expect(mocks.openDatabase).toHaveBeenCalledWith(connectionConfig);
		expect(mocks.client.end).not.toHaveBeenCalled();
		backgroundWork.resolve();
		await finished;
		expect(mocks.client.end).toHaveBeenCalledOnce();
	});

	it("reports a dropped connection instead of letting it crash the process", async () => {
		await runInvocation({ trigger: "fetch" }, () => createDb(connectionConfig))
			.finished;
		const connectionLost = new Error("Connection lost");
		const [eventName, onError] = mocks.client.on.mock.calls[0] ?? [];
		expect(eventName).toBe("error");
		if (typeof onError !== "function") {
			throw new Error("No connection error listener registered");
		}
		onError(connectionLost);

		expect(mocks.createLogger).toHaveBeenCalledWith({
			runtime: "node",
			failedIn: "database_connection",
		});
		expect(mocks.logger.error).toHaveBeenCalledWith(connectionLost);
	});
});
