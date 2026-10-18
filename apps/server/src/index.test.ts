import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	DEMO_REQUEST_RATE_LIMIT_MAX_REQUESTS,
	DEMO_REQUEST_RATE_LIMIT_WINDOW_MS,
	MAX_REQUEST_BODY_BYTES,
} from "./constants";
import app from "./index";

const databaseRequire = createRequire(
	import.meta.resolve("@hack-the-andes-project/db"),
);
const { DrizzleQueryError } = databaseRequire("drizzle-orm");

const mocks = vi.hoisted(() => ({
	createDb: vi.fn(),
	getSession: vi.fn(),
	authHandler: vi.fn(async () => Response.json({ success: true })),
	insert: vi.fn(),
	log: { set: vi.fn(), error: vi.fn() },
}));

vi.mock("./env.server", () => ({
	ENV: {
		ALLOWED_ORIGINS: "https://app.example.com",
		CLIENT_IP_HEADER: "x-real-ip",
		HYPERDRIVE: {},
	},
}));
vi.mock("@hack-the-andes-project/db", () => ({ createDb: mocks.createDb }));
vi.mock("@hack-the-andes-project/auth", async (importOriginal) => ({
	...(await importOriginal<typeof import("@hack-the-andes-project/auth")>()),
	createAuth: () => ({
		api: { getSession: mocks.getSession },
		handler: mocks.authHandler,
	}),
}));
vi.mock("evlog/workers", () => ({ initWorkersLogger: vi.fn() }));
vi.mock("evlog/hono", () => ({
	evlog:
		() =>
		async (
			context: { set: (name: string, value: unknown) => void; error?: Error },
			next: () => Promise<void>,
		) => {
			context.set("log", mocks.log);
			await next();
			if (context.error) mocks.log.error(context.error);
		},
}));

let testWindowStart = Date.now();

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
	testWindowStart += DEMO_REQUEST_RATE_LIMIT_WINDOW_MS;
	vi.setSystemTime(testWindowStart);
	mocks.createDb.mockResolvedValue({
		insert: () => ({ values: mocks.insert }),
	});
	mocks.getSession.mockResolvedValue(null);
});

afterEach(() => {
	testWindowStart = Date.now();
	vi.useRealTimers();
});

describe("server edge", () => {
	it.each(["POST", "PUT", "PATCH", "DELETE"])(
		"rejects cross-site RPC %s before opening the database",
		async (method) => {
			const response = await app.request("/rpc/healthCheck", {
				method,
				headers: { Origin: "https://attacker.example" },
			});
			expect(response.status).toBe(403);
			expect(await response.json()).toMatchObject({
				error: "forbidden_origin",
			});
			expect(mocks.createDb).not.toHaveBeenCalled();
			expect(mocks.log.set).toHaveBeenCalledWith({
				auth: { gate: "forbidden_origin", origin: "https://attacker.example" },
			});
		},
	);

	it("rejects cross-site multipart RPC forms", async () => {
		const body = new FormData();
		body.set("data", JSON.stringify({ json: {} }));
		const response = await app.request("/rpc/privateData", {
			method: "POST",
			headers: { Origin: "https://attacker.example" },
			body,
		});
		expect(response.status).toBe(403);
		expect(mocks.createDb).not.toHaveBeenCalled();
	});

	it.each([undefined, "https://app.example.com"])(
		"allows RPC POST with absent or trusted Origin (%s)",
		async (origin) => {
			const response = await app.request("/rpc/healthCheck", {
				method: "POST",
				headers: origin ? { Origin: origin } : {},
			});
			expect(response.status).toBe(200);
			expect(mocks.createDb).toHaveBeenCalledTimes(1);
		},
	);

	it("keeps preflight public and free of database work", async () => {
		const response = await app.request("/rpc/privateData", {
			method: "OPTIONS",
			headers: {
				Origin: "https://app.example.com",
				"Access-Control-Request-Method": "POST",
			},
		});
		expect(response.status).toBe(204);
		expect(mocks.createDb).not.toHaveBeenCalled();
	});

	it("rejects GET for a procedure without an explicit GET method", async () => {
		const response = await app.request("/rpc/healthCheck", {
			headers: { Origin: "https://attacker.example" },
		});
		expect(response.status).toBe(405);
	});

	it.each(["1", ""])(
		"requires a session for a public URL with a batch header (%s)",
		async (batchHeader) => {
			const response = await app.request("/rpc/healthCheck", {
				method: "POST",
				headers: { "x-orpc-batch": batchHeader },
			});
			expect(response.status).toBe(401);
			expect(await response.json()).toMatchObject({ error: "unauthorized" });
			expect(mocks.log.set).toHaveBeenCalledWith({ auth: { gate: "denied" } });
		},
	);

	it.each([
		"/api/demo-requests",
		"/api/auth/sign-in/email",
		"/rpc/privateData",
		"/",
	])("caps bodies before public or protected handlers at %s", async (path) => {
		const response = await app.request(path, {
			method: "POST",
			body: "x".repeat(MAX_REQUEST_BODY_BYTES + 1),
		});
		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({ error: "payload_too_large" });
		expect(mocks.createDb).not.toHaveBeenCalled();
		expect(mocks.authHandler).not.toHaveBeenCalled();
	});

	it("caps bodies declared by content-length", async () => {
		const response = await app.request("/api/demo-requests", {
			method: "POST",
			headers: { "Content-Length": String(MAX_REQUEST_BODY_BYTES + 1) },
			body: "x",
		});
		expect(response.status).toBe(413);
		expect(mocks.createDb).not.toHaveBeenCalled();
	});

	it("accepts a body at the limit", async () => {
		const response = await app.request("/api/auth/test", {
			method: "POST",
			body: "x".repeat(MAX_REQUEST_BODY_BYTES),
		});
		expect(response.status).toBe(200);
		expect(mocks.authHandler).toHaveBeenCalledTimes(1);
	});

	it.each(["203.0.113.10", undefined])(
		"throttles a client including the missing-IP bucket (%s)",
		async (clientIp) => {
			for (
				let requestIndex = 0;
				requestIndex < DEMO_REQUEST_RATE_LIMIT_MAX_REQUESTS;
				requestIndex++
			) {
				const response = await app.request("/api/demo-requests", {
					method: "POST",
					headers: clientIp ? { "x-real-ip": clientIp } : {},
					body: JSON.stringify({ name: "Ana", email: "ana@example.com" }),
				});
				expect(response.status).toBe(201);
			}
			mocks.createDb.mockClear();
			const response = await app.request("/api/demo-requests", {
				method: "POST",
				headers: clientIp ? { "x-real-ip": clientIp } : {},
			});
			expect(response.status).toBe(429);
			expect(await response.json()).toEqual({
				error: "too_many_demo_requests",
			});
			expect(mocks.createDb).not.toHaveBeenCalled();
			const otherClient = await app.request("/api/demo-requests", {
				method: "POST",
				headers: { "x-real-ip": "203.0.113.11" },
			});
			expect(otherClient.status).toBe(400);
			vi.advanceTimersByTime(DEMO_REQUEST_RATE_LIMIT_WINDOW_MS);
			const nextWindow = await app.request("/api/demo-requests", {
				method: "POST",
				headers: clientIp ? { "x-real-ip": clientIp } : {},
			});
			expect(nextWindow.status).toBe(400);
		},
	);

	it.each([false, true])(
		"returns a clean 500 and logs SQL and code without lead parameters (wrapped: %s)",
		async (wrapped) => {
			const query = "insert into demo_request values (?, ?, ?, ?)";
			const lead = [
				"Private Name",
				"Private Company",
				"private-phone",
				"private@example.com",
			];
			const queryError = new DrizzleQueryError(
				query,
				lead,
				Object.assign(new Error(`Duplicate entry ${lead.join(",")}`), {
					code: "ER_DUP_ENTRY",
				}),
			);
			mocks.insert.mockRejectedValueOnce(
				wrapped
					? new Error(queryError.message, { cause: queryError })
					: queryError,
			);
			const response = await app.request("/api/demo-requests", {
				method: "POST",
				body: JSON.stringify({
					name: lead[0],
					company: lead[1],
					phone: lead[2],
					email: lead[3],
				}),
			});
			expect(response.status).toBe(500);
			expect(await response.json()).toMatchObject({ error: "internal_error" });
			expect(mocks.log.set).toHaveBeenCalledWith({
				database: { query, driverCode: "ER_DUP_ENTRY" },
			});
			expect(mocks.log.error).toHaveBeenCalled();
			for (const [loggedError] of mocks.log.error.mock.calls) {
				expect(loggedError).toBeInstanceOf(Error);
				expect(loggedError.message).toBe("Database query failed");
				expect(loggedError.cause).toBeUndefined();
				const loggedData =
					JSON.stringify(mocks.log.set.mock.calls) + loggedError.stack;
				for (const parameter of lead)
					expect(loggedData).not.toContain(parameter);
			}
		},
	);

	it("sanitizes query errors outside the lead form", async () => {
		mocks.createDb.mockRejectedValueOnce(
			new DrizzleQueryError(
				"select ?",
				["private-value"],
				new Error("private-value"),
			),
		);
		const response = await app.request("/rpc/privateData");
		expect(response.status).toBe(500);
		expect(mocks.log.set).toHaveBeenCalledWith({
			database: { query: "select ?", driverCode: undefined },
		});
		for (const [loggedError] of mocks.log.error.mock.calls) {
			expect(loggedError.message).toBe("Database query failed");
			expect(loggedError.cause).toBeUndefined();
		}
	});

	it("removes the OpenAPI reference surface", async () => {
		mocks.getSession.mockResolvedValue({
			user: { id: "owner", email: "owner@example.com" },
			session: { id: "session", userId: "owner" },
		});
		const response = await app.request("/api-reference");
		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ error: "not_found" });
		expect(mocks.authHandler).not.toHaveBeenCalled();
	});
});
