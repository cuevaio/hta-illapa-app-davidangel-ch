import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_HTTP_PORT, MYSQL_DEFAULT_PORT } from "./constants";

async function importFreshShim() {
	vi.resetModules();
	return import("./cloudflare-workers");
}

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("cloudflare:workers env", () => {
	it("parses DATABASE_URL into the Hyperdrive fields, decoding the credentials", async () => {
		const databaseUrl =
			"mysql://fleet%40ops:p%40ss%3Aw%2Frd%23@db.internal:3307/fierros";
		vi.stubEnv("DATABASE_URL", databaseUrl);
		const { env } = await importFreshShim();
		expect(env.HYPERDRIVE).toEqual({
			host: "db.internal",
			port: 3307,
			user: "fleet@ops",
			password: "p@ss:w/rd#",
			database: "fierros",
			connectionString: databaseUrl,
		});
	});

	it("defaults the database port to MySQL's", async () => {
		vi.stubEnv("DATABASE_URL", "mysql://user:secret@db.internal/fierros");
		const { env } = await importFreshShim();
		expect(env.HYPERDRIVE.port).toBe(MYSQL_DEFAULT_PORT);
	});

	it("passes every other variable through as a string", async () => {
		vi.stubEnv("DATABASE_URL", "mysql://user:secret@db.internal/fierros");
		vi.stubEnv("ALLOWED_ORIGINS", "https://dash.illapa.app");
		const { env } = await importFreshShim();
		expect(env.ALLOWED_ORIGINS).toBe("https://dash.illapa.app");
	});

	it("refuses to start without DATABASE_URL", async () => {
		vi.stubEnv("DATABASE_URL", undefined);
		await expect(importFreshShim()).rejects.toThrow("DATABASE_URL is required");
	});

	it("listens on PORT, falling back to the default port", async () => {
		vi.stubEnv("DATABASE_URL", "mysql://user:secret@db.internal/fierros");
		vi.stubEnv("PORT", undefined);
		expect((await importFreshShim()).port).toBe(DEFAULT_HTTP_PORT);
		vi.stubEnv("PORT", "4100");
		expect((await importFreshShim()).port).toBe(4100);
	});
});

describe("SELF service binding", () => {
	it("re-targets a request to this process, keeping path, query, method, headers and body", async () => {
		vi.stubEnv("DATABASE_URL", "mysql://user:secret@db.internal/fierros");
		vi.stubEnv("PORT", "4321");
		const fetchMock = vi.fn<typeof fetch>(
			async () => new Response("forwarded"),
		);
		vi.stubGlobal("fetch", fetchMock);
		const { env } = await importFreshShim();

		const response = await env.SELF.fetch(
			"https://scraper.internal/run?source=sutran_alerts",
			{
				method: "POST",
				headers: { "x-scraper-secret": "run-secret" },
				body: "payload",
			},
		);

		expect(await response.text()).toBe("forwarded");
		const forwarded = fetchMock.mock.calls[0]?.[0];
		if (!(forwarded instanceof Request)) {
			throw new Error("SELF did not forward a Request");
		}
		expect(forwarded.url).toBe(
			"http://127.0.0.1:4321/run?source=sutran_alerts",
		);
		expect(forwarded.method).toBe("POST");
		expect(forwarded.headers.get("x-scraper-secret")).toBe("run-secret");
		expect(await forwarded.text()).toBe("payload");
	});

	it("accepts a Request as input", async () => {
		vi.stubEnv("DATABASE_URL", "mysql://user:secret@db.internal/fierros");
		vi.stubEnv("PORT", "4321");
		const fetchMock = vi.fn<typeof fetch>(async () => new Response("ok"));
		vi.stubGlobal("fetch", fetchMock);
		const { env } = await importFreshShim();

		await env.SELF.fetch(
			new Request("https://scraper.internal/risk", { method: "POST" }),
		);

		const forwarded = fetchMock.mock.calls[0]?.[0];
		if (!(forwarded instanceof Request)) {
			throw new Error("SELF did not forward a Request");
		}
		expect(forwarded.url).toBe("http://127.0.0.1:4321/risk");
		expect(forwarded.method).toBe("POST");
	});
});
