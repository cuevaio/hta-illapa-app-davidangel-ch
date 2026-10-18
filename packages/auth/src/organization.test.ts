import { createRequire } from "node:module";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	expectTypeOf,
	it,
	vi,
} from "vitest";

import type { Session } from "./index";

const databaseRequire = createRequire(
	import.meta.resolve("@hack-the-andes-project/db"),
);
vi.doMock(databaseRequire.resolve("mysql2/promise"), () => ({
	default: {
		createConnection: vi.fn(async () => ({
			config: {},
			query: vi.fn(),
			end: vi.fn(),
		})),
	},
}));

const { createDb } = await import("@hack-the-andes-project/db");
const { createAuth } = await import("./index");
const database = await createDb({
	host: "mock",
	port: Number.NaN,
	user: "mock",
	password: "mock",
	database: "mock",
});

describe("organization database hooks", () => {
	const auth = createAuth(
		{
			BETTER_AUTH_URL: "https://api.example.com",
			BETTER_AUTH_SECRET: "test-secret-for-organization-database-hooks",
			ALLOWED_ORIGINS: "https://app.example.com",
			CLIENT_IP_HEADER: "cf-connecting-ip",
		},
		database,
	);
	const createdAt = new Date("2026-10-17T00:00:00.000Z");
	const user = {
		id: "personal-owner",
		name: "Fleet Owner",
		email: "owner@example.com",
		emailVerified: false,
		image: null,
		createdAt,
		updatedAt: createdAt,
	};
	const session = {
		id: "new-session",
		userId: user.id,
		token: "session-token",
		createdAt,
		updatedAt: createdAt,
		expiresAt: new Date("2026-10-18T00:00:00.000Z"),
	};

	beforeEach(() => {
		vi.spyOn(database.$client, "query").mockResolvedValue([[], []]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		await database.$client.end();
	});

	it("creates the personal organization before the deferred sign-up hook", async () => {
		vi.spyOn(database.query.member, "findFirst").mockResolvedValue(undefined);
		vi.spyOn(database.query.user, "findFirst").mockResolvedValue(user);

		const result =
			await auth.options.databaseHooks.session.create.before(session);
		await auth.options.databaseHooks.user.create.after(user);

		expect(result?.data.activeOrganizationId).toBe(user.id);
		expect(database.$client.query).toHaveBeenCalledWith(
			expect.objectContaining({
				sql: expect.stringMatching(
					/insert into `hack_the_andes_organization`.*on duplicate key update/,
				),
			}),
			expect.arrayContaining([
				user.id,
				user.name,
				expect.stringMatching(/^personal-[a-f\d-]+$/),
			]),
		);
		expect(database.$client.query).toHaveBeenCalledWith(
			expect.objectContaining({
				sql: expect.stringMatching(
					/insert into `hack_the_andes_member`.*on duplicate key update/,
				),
			}),
			expect.arrayContaining([user.id, "owner"]),
		);
	});

	it("selects the first membership for a new session", async () => {
		const membershipLookup = vi
			.spyOn(database.query.member, "findFirst")
			.mockResolvedValue({
				id: "existing-member",
				organizationId: "existing-organization",
				userId: user.id,
				role: "member",
				createdAt,
			});

		const result =
			await auth.options.databaseHooks.session.create.before(session);

		expect(result?.data.activeOrganizationId).toBe("existing-organization");
		expect(membershipLookup).toHaveBeenCalledWith({
			where: { userId: user.id },
			orderBy: { createdAt: "asc", id: "asc" },
		});
		expect(database.$client.query).not.toHaveBeenCalled();
	});

	it("preserves an already selected active organization", async () => {
		const membershipLookup = vi.spyOn(database.query.member, "findFirst");

		const result = await auth.options.databaseHooks.session.create.before({
			...session,
			activeOrganizationId: "selected-organization",
		});

		expect(result).toBeUndefined();
		expect(membershipLookup).not.toHaveBeenCalled();
		expect(database.$client.query).not.toHaveBeenCalled();
	});

	it("does not create an orphan organization when the user is missing", async () => {
		vi.spyOn(database.query.member, "findFirst").mockResolvedValue(undefined);
		vi.spyOn(database.query.user, "findFirst").mockResolvedValue(undefined);

		const result =
			await auth.options.databaseHooks.session.create.before(session);

		expect(result).toBeUndefined();
		expect(database.$client.query).not.toHaveBeenCalled();
	});

	it("exposes the active organization in the exported session type", () => {
		expectTypeOf<
			NonNullable<Session>["session"]["activeOrganizationId"]
		>().toEqualTypeOf<string | null | undefined>();
	});
});
