import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	runSecret: "run-secret",
	createDb: vi.fn(),
	findSource: vi.fn(() => undefined),
}));

vi.mock("./env.server", () => ({
	ENV: {
		get SCRAPER_RUN_SECRET() {
			return mocks.runSecret;
		},
	},
}));
vi.mock("@hack-the-andes-project/db", () => ({ createDb: mocks.createDb }));
vi.mock("@hack-the-andes-project/business/risk/assess", () => ({
	assessRoadRisk: vi.fn(),
}));
vi.mock("./sources", () => ({
	findSource: mocks.findSource,
	sourcesForSchedule: vi.fn(),
}));
vi.mock("./sync", () => ({ runSource: vi.fn() }));
vi.mock("./lib/media-bucket", () => ({ createMediaBucket: vi.fn() }));
vi.mock("evlog/workers", () => ({ initWorkersLogger: vi.fn() }));

import worker from "./index";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.runSecret = "run-secret";
});

describe("scraper run secret", () => {
	it.each(["/run", "/risk"])(
		"rejects missing, empty and incorrect secrets at %s",
		async (path) => {
			for (const providedSecret of [undefined, "", "wrong-secret"]) {
				const response = await worker.fetch(
					new Request(`https://worker.test${path}`, {
						method: "POST",
						headers:
							providedSecret === undefined
								? {}
								: { "x-scraper-secret": providedSecret },
					}),
				);
				expect(response.status).toBe(401);
			}
			expect(mocks.createDb).not.toHaveBeenCalled();
		},
	);

	it("fails closed when both configured and provided secrets are empty", async () => {
		mocks.runSecret = "";
		const response = await worker.fetch(
			new Request("https://worker.test/run", {
				method: "POST",
				headers: { "x-scraper-secret": "" },
			}),
		);
		expect(response.status).toBe(401);
		expect(mocks.createDb).not.toHaveBeenCalled();
	});

	it("accepts the configured secret before resolving the source", async () => {
		const response = await worker.fetch(
			new Request("https://worker.test/run?source=missing", {
				method: "POST",
				headers: { "x-scraper-secret": "run-secret" },
			}),
		);
		expect(response.status).toBe(400);
		expect(mocks.findSource).toHaveBeenCalledWith("missing");
	});
});
