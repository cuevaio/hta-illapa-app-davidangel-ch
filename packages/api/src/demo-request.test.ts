import { createRequire } from "node:module";
import { DEMO_NAME_MAX_LENGTH_CHARS } from "@hack-the-andes-project/business/constants";
import { DEMO_REQUESTS_PATH } from "@hack-the-andes-project/business/demo-request";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HTTP_STATUS_BAD_REQUEST, HTTP_STATUS_CREATED } from "./constants";
import { handleDemoRequest } from "./demo-request";

const databaseRequire = createRequire(
	import.meta.resolve("@hack-the-andes-project/db"),
);
vi.doMock(databaseRequire.resolve("mysql2/promise"), () => ({
	default: {
		createConnection: vi.fn(async () => ({
			config: {},
			query: vi.fn(async () => [{ affectedRows: 1 }, []]),
		})),
	},
}));

const { createDb } = await import("@hack-the-andes-project/db");
const database = await createDb({
	host: "mock",
	port: Number.NaN,
	user: "mock",
	password: "mock",
	database: "mock",
});
const createDatabase = vi.fn(async () => database);
const log = { set: vi.fn() };

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("demo requests", () => {
	it.each([
		{
			label: "phone only",
			payload: { name: "Ana", phone: "+51 987 654 321" },
			stored: ["Ana", null, "+51 987 654 321", null],
		},
		{
			label: "email only",
			payload: { name: "Ana", email: "ana@example.com" },
			stored: ["Ana", null, null, "ana@example.com"],
		},
		{
			label: "all fields",
			payload: {
				name: " Ana ",
				company: " Transportes Andes ",
				phone: " +51 987 654 321 ",
				email: " ana@example.com ",
			},
			stored: [
				"Ana",
				"Transportes Andes",
				"+51 987 654 321",
				"ana@example.com",
			],
		},
		{
			label: "explicit empty optional fields",
			payload: {
				name: "Ana",
				company: "",
				phone: "+51 987 654 321",
				email: "",
			},
			stored: ["Ana", "", "+51 987 654 321", ""],
		},
	])("stores $label and returns an empty 201", async ({ payload, stored }) => {
		const response = await handleDemoRequest({
			request: new Request(`https://api.example.com${DEMO_REQUESTS_PATH}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			}),
			createDatabase,
			log,
		});

		expect(response.status).toBe(HTTP_STATUS_CREATED);
		expect(await response.text()).toBe("");
		expect(createDatabase).toHaveBeenCalledExactlyOnceWith();
		expect(database.$client.query).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				sql: expect.stringContaining("`hack_the_andes_demo_request`"),
			}),
			[expect.any(String), ...stored],
		);
		expect(log.set).toHaveBeenCalledExactlyOnceWith({
			demoRequest: { requestId: expect.any(String) },
		});
		const storedParameters = vi.mocked(database.$client.query).mock
			.calls[0]?.[1];
		expect(storedParameters).toEqual([
			log.set.mock.calls[0]?.[0].demoRequest.requestId,
			...stored,
		]);
	});

	it.each([
		{ label: "invalid JSON", body: "{" },
		{ label: "empty body", body: "" },
		{ label: "null", body: "null" },
		{ label: "missing name", body: JSON.stringify({ phone: "987654321" }) },
		{
			label: "blank name",
			body: JSON.stringify({ name: " ", phone: "987654321" }),
		},
		{ label: "missing contact", body: JSON.stringify({ name: "Ana" }) },
		{
			label: "invalid email",
			body: JSON.stringify({ name: "Ana", email: "invalid" }),
		},
		{
			label: "oversized name",
			body: JSON.stringify({
				name: "a".repeat(DEMO_NAME_MAX_LENGTH_CHARS + 1),
				phone: "987654321",
			}),
		},
	])(
		"returns 400 for $label without opening the database",
		async ({ body }) => {
			const response = await handleDemoRequest({
				request: new Request(`https://api.example.com${DEMO_REQUESTS_PATH}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body,
				}),
				createDatabase,
				log,
			});

			expect(response.status).toBe(HTTP_STATUS_BAD_REQUEST);
			expect(await response.json()).toEqual({ error: "invalid_demo_request" });
			expect(createDatabase).not.toHaveBeenCalled();
			expect(database.$client.query).not.toHaveBeenCalled();
			expect(log.set).not.toHaveBeenCalled();
		},
	);

	it("lets database failures propagate to the server error handler", async () => {
		const databaseError = new Error("database unavailable");
		createDatabase.mockRejectedValueOnce(databaseError);

		await expect(
			handleDemoRequest({
				request: new Request(`https://api.example.com${DEMO_REQUESTS_PATH}`, {
					method: "POST",
					body: JSON.stringify({ name: "Ana", email: "ana@example.com" }),
				}),
				createDatabase,
				log,
			}),
		).rejects.toBe(databaseError);
		expect(log.set).not.toHaveBeenCalled();
	});
});
