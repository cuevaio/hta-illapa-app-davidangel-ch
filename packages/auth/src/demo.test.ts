import { createRequire } from "node:module";
import {
	DEMO_ACCOUNT_EMAIL,
	DEMO_ACCOUNT_ROLE,
	DEMO_SIGN_IN_AUTH_PATH,
} from "@hack-the-andes-project/business/demo-account";
import { betterAuth } from "better-auth";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import {
	DEMO_BLOCKED_AUTH_PATHS,
	DEMO_CHANGE_FORBIDDEN_MESSAGE,
	DEMO_RATE_LIMIT_MAX_REQUESTS,
	DEMO_RATE_LIMIT_WINDOW_S,
	DEMO_SESSION_CONFLICT_MESSAGE,
} from "./constants";
import { demoAccess } from "./demo";

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
const auth = createAuth(
	{
		BETTER_AUTH_URL: "https://api.example.com",
		BETTER_AUTH_SECRET: "demo-auth-test-secret-long-enough-for-auth",
		ALLOWED_ORIGINS: "https://app.example.com",
		CLIENT_IP_HEADER: "cf-connecting-ip",
	},
	database,
);
const createdAt = new Date("2026-10-17T00:00:00Z");
const user = {
	id: "demo-user",
	name: "Demo ILLAPA",
	email: DEMO_ACCOUNT_EMAIL,
	emailVerified: true,
	image: null,
	role: DEMO_ACCOUNT_ROLE,
	createdAt,
	updatedAt: createdAt,
};
const session = {
	id: "demo-session",
	userId: user.id,
	token: "demo-token",
	expiresAt: new Date("2099-01-01"),
	createdAt,
	updatedAt: createdAt,
	activeOrganizationId: user.id,
};
const unthrottledAuth = betterAuth({
	...auth.options,
	rateLimit: { ...auth.options.rateLimit, enabled: false },
});
const unthrottledContext = await unthrottledAuth.$context;
vi.spyOn(
	unthrottledContext.internalAdapter,
	"findUserByEmail",
).mockResolvedValue({ user, accounts: [] });
vi.spyOn(unthrottledContext.internalAdapter, "createSession").mockResolvedValue(
	session,
);
const signedIn = await unthrottledAuth.api.signInDemo({
	headers: new Headers(),
	returnHeaders: true,
});
vi.restoreAllMocks();
const sessionCookie = signedIn.headers
	.getSetCookie()
	.map((value) => value.split(";")[0])
	.join("; ");

function demoSignInWithSessionCookie() {
	return unthrottledAuth.handler(
		new Request(`https://api.example.com/api/auth${DEMO_SIGN_IN_AUTH_PATH}`, {
			method: "POST",
			headers: { cookie: sessionCookie, origin: "https://app.example.com" },
		}),
	);
}

afterEach(() => vi.restoreAllMocks());
afterAll(async () => database.$client.end());

describe("demo access", () => {
	it.each([...DEMO_BLOCKED_AUTH_PATHS])(
		"blocks demo access at %s",
		async (path) => {
			const hook = demoAccess.hooks.before[0];
			if (!hook) throw new Error("Demo guard missing");
			const hookContext = {
				path,
				headers: new Headers(),
				context: { ...(await auth.$context), session: { user, session } },
			};
			expect(hook.matcher(hookContext)).toBe(true);
			await expect(hook.handler(hookContext)).rejects.toMatchObject({
				status: "FORBIDDEN",
				body: { message: DEMO_CHANGE_FORBIDDEN_MESSAGE },
			});
		},
	);

	it.each([
		"/list-sessions",
		"/list-accounts",
		"/account-info",
		"/organization/get-full-organization",
		"/organization/list-members",
		"/organization/get-invitation",
		"/organization/list-invitations",
		"/organization/list-user-invitations",
	])(
		"returns HTTP 403 before disclosing shared account data at %s",
		async (path) => {
			vi.spyOn(
				unthrottledContext.internalAdapter,
				"findSession",
			).mockResolvedValue({ user, session });
			const listSessions = vi.spyOn(
				unthrottledContext.internalAdapter,
				"listSessions",
			);
			const response = await unthrottledAuth.handler(
				new Request(`https://api.example.com/api/auth${path}`, {
					headers: { cookie: sessionCookie, origin: "https://app.example.com" },
				}),
			);
			expect(response.status).toBe(403);
			expect(await response.json()).toMatchObject({
				message: DEMO_CHANGE_FORBIDDEN_MESSAGE,
			});
			expect(listSessions).not.toHaveBeenCalled();
		},
	);

	it("still lists sessions for ordinary users", async () => {
		vi.spyOn(
			unthrottledContext.internalAdapter,
			"findSession",
		).mockResolvedValue({
			user: { ...user, email: "owner@example.com" },
			session: { ...session, createdAt: new Date() },
		});
		const listSessions = vi
			.spyOn(unthrottledContext.internalAdapter, "listSessions")
			.mockResolvedValue([]);
		const response = await unthrottledAuth.handler(
			new Request("https://api.example.com/api/auth/list-sessions", {
				headers: {
					cookie: sessionCookie
						.split("; ")
						.filter((cookie) =>
							cookie.startsWith(
								`${unthrottledContext.authCookies.sessionToken.name}=`,
							),
						)
						.join("; "),
				},
			}),
		);
		expect(await response.json()).toEqual([]);
		expect(response.status).toBe(200);
		expect(listSessions).toHaveBeenCalledWith(user.id, {
			onlyActiveSessions: true,
		});
	});

	it("allows ordinary users through the mutation hook and leaves sign-out available", async () => {
		const hook = demoAccess.hooks.before[0];
		if (!hook) throw new Error("Demo guard missing");
		const hookContext = {
			path: "/sign-out",
			headers: new Headers(),
			context: {
				...(await auth.$context),
				session: { user: { ...user, email: "owner@example.com" }, session },
			},
		};
		expect(hook.matcher(hookContext)).toBe(false);
		await expect(hook.handler(hookContext)).resolves.toBeUndefined();
	});

	it("has an independent 120 per minute rule for the demo endpoint", () => {
		const rule = demoAccess.rateLimit[0];
		if (!rule) throw new Error("Demo rate limit missing");
		expect(rule.pathMatcher(DEMO_SIGN_IN_AUTH_PATH)).toBe(true);
		expect(rule.pathMatcher("/sign-in/email")).toBe(false);
		expect(rule.max).toBe(DEMO_RATE_LIMIT_MAX_REQUESTS);
		expect(rule.window).toBe(DEMO_RATE_LIMIT_WINDOW_S);
		expect(rule).toMatchObject({ max: 120, window: 60 });
	});

	it("allows 120 venue requests and rate-limits the 121st", async () => {
		const limitedAuth = betterAuth({
			...auth.options,
			rateLimit: { ...auth.options.rateLimit, storage: "memory" },
		});
		const context = await limitedAuth.$context;
		vi.spyOn(context.internalAdapter, "findUserByEmail").mockResolvedValue({
			user,
			accounts: [],
		});
		vi.spyOn(context.internalAdapter, "createSession").mockResolvedValue(
			session,
		);
		for (
			let requestIndex = 0;
			requestIndex < DEMO_RATE_LIMIT_MAX_REQUESTS;
			requestIndex++
		) {
			const response = await limitedAuth.handler(
				new Request(
					`https://api.example.com/api/auth${DEMO_SIGN_IN_AUTH_PATH}`,
					{
						method: "POST",
						headers: {
							"cf-connecting-ip": "203.0.113.10",
							origin: "https://app.example.com",
						},
					},
				),
			);
			expect(response.status).toBe(200);
		}
		const response = await limitedAuth.handler(
			new Request(`https://api.example.com/api/auth${DEMO_SIGN_IN_AUTH_PATH}`, {
				method: "POST",
				headers: {
					"cf-connecting-ip": "203.0.113.10",
					origin: "https://app.example.com",
				},
			}),
		);
		expect(response.status).toBe(429);
	});

	it("signs in through the internal adapter and issues a cookie", async () => {
		const context = await auth.$context;
		vi.spyOn(context.internalAdapter, "findUserByEmail").mockResolvedValue({
			user,
			accounts: [],
		});
		const createSession = vi
			.spyOn(context.internalAdapter, "createSession")
			.mockResolvedValue(session);
		const createUser = vi.spyOn(context.internalAdapter, "createUser");
		const result = await auth.api.signInDemo({
			headers: new Headers(),
			returnHeaders: true,
		});
		expect(result.response).toEqual({ success: true });
		expect(result.headers.get("set-cookie")).toContain("session_token=");
		expect(createSession).toHaveBeenCalledWith(user.id);
		expect(createUser).not.toHaveBeenCalled();
	});

	it("creates a verified demo user without a credential account", async () => {
		const context = await auth.$context;
		vi.spyOn(context.internalAdapter, "findUserByEmail").mockResolvedValue(
			null,
		);
		const createUser = vi
			.spyOn(context.internalAdapter, "createUser")
			.mockResolvedValue(user);
		vi.spyOn(context.internalAdapter, "createSession").mockResolvedValue(
			session,
		);
		const linkAccount = vi.spyOn(context.internalAdapter, "linkAccount");
		await auth.api.signInDemo({ headers: new Headers() });
		expect(createUser).toHaveBeenCalledWith(
			{
				email: DEMO_ACCOUNT_EMAIL,
				name: user.name,
				emailVerified: true,
				role: DEMO_ACCOUNT_ROLE,
			},
			{ method: "demo" },
		);
		expect(linkAccount).not.toHaveBeenCalled();
	});

	it("recovers when another visitor creates the demo user first", async () => {
		const context = await auth.$context;
		vi.spyOn(context.internalAdapter, "findUserByEmail")
			.mockResolvedValueOnce(null)
			.mockResolvedValue({ user, accounts: [] });
		vi.spyOn(context.internalAdapter, "createUser").mockRejectedValue(
			new Error("Duplicate email"),
		);
		vi.spyOn(context.internalAdapter, "createSession").mockResolvedValue(
			session,
		);
		await expect(
			auth.api.signInDemo({ headers: new Headers() }),
		).resolves.toEqual({ success: true });
	});

	it("returns HTTP 403 before a demo profile can be changed", async () => {
		vi.spyOn(
			unthrottledContext.internalAdapter,
			"findSession",
		).mockResolvedValue({ user, session });
		const response = await unthrottledAuth.handler(
			new Request("https://api.example.com/api/auth/update-user", {
				method: "POST",
				headers: {
					cookie: sessionCookie,
					origin: "https://app.example.com",
					"content-type": "application/json",
				},
				body: JSON.stringify({ name: "Alterado" }),
			}),
		);
		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({
			message: DEMO_CHANGE_FORBIDDEN_MESSAGE,
		});
	});

	it("returns HTTP 409 and writes no cookie while another account is signed in", async () => {
		vi.spyOn(
			unthrottledContext.internalAdapter,
			"findSession",
		).mockResolvedValue({
			user: { ...user, email: "owner@example.com" },
			session,
		});
		const createSession = vi.spyOn(
			unthrottledContext.internalAdapter,
			"createSession",
		);
		const response = await demoSignInWithSessionCookie();
		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toMatchObject({
			message: DEMO_SESSION_CONFLICT_MESSAGE,
		});
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(createSession).not.toHaveBeenCalled();
	});

	it("reuses an open demo session instead of creating another", async () => {
		vi.spyOn(
			unthrottledContext.internalAdapter,
			"findSession",
		).mockResolvedValue({ user, session });
		const createSession = vi.spyOn(
			unthrottledContext.internalAdapter,
			"createSession",
		);
		const response = await demoSignInWithSessionCookie();
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ success: true });
		expect(createSession).not.toHaveBeenCalled();
		expect(response.headers.get("set-cookie")).toContain(
			`session_token=${session.token}.`,
		);
	});

	it("fails with HTTP 500 instead of replacing a session it cannot read", async () => {
		vi.spyOn(
			unthrottledContext.internalAdapter,
			"findSession",
		).mockRejectedValue(new Error("Connection lost"));
		vi.spyOn(
			unthrottledContext.internalAdapter,
			"findUserByEmail",
		).mockResolvedValue({ user, accounts: [] });
		const createSession = vi
			.spyOn(unthrottledContext.internalAdapter, "createSession")
			.mockResolvedValue(session);
		const response = await demoSignInWithSessionCookie();
		expect(response.status).toBe(500);
		expect(createSession).not.toHaveBeenCalled();
	});

	it.each([
		["is gone", null],
		[
			"has expired",
			{
				user: { ...user, email: "owner@example.com" },
				session: { ...session, expiresAt: new Date("2020-01-01") },
			},
		],
	])(
		"issues a new demo session when the cookie's session %s",
		async (_, storedSession) => {
			vi.spyOn(
				unthrottledContext.internalAdapter,
				"findSession",
			).mockResolvedValue(storedSession);
			vi.spyOn(
				unthrottledContext.internalAdapter,
				"findUserByEmail",
			).mockResolvedValue({ user, accounts: [] });
			const createSession = vi
				.spyOn(unthrottledContext.internalAdapter, "createSession")
				.mockResolvedValue(session);
			const response = await demoSignInWithSessionCookie();
			expect(response.status).toBe(200);
			expect(createSession).toHaveBeenCalledWith(user.id);
			const sessionTokenCookies = response.headers
				.getSetCookie()
				.filter((value) => value.includes("session_token="));
			expect(sessionTokenCookies.at(-1)).toContain(
				`session_token=${session.token}.`,
			);
		},
	);

	it("runs the organization hooks for the actual plugin sign-in path", async () => {
		const context = await auth.$context;
		vi.spyOn(context.internalAdapter, "findUserByEmail").mockResolvedValue(
			null,
		);
		vi.spyOn(context.adapter, "create").mockImplementation(
			async ({ model, data }) => ({
				...data,
				id: model === "user" ? user.id : session.id,
			}),
		);
		vi.spyOn(database.query.member, "findFirst").mockResolvedValue(undefined);
		vi.spyOn(database.query.user, "findFirst").mockResolvedValue(user);
		const query = vi
			.spyOn(database.$client, "query")
			.mockResolvedValue([[], []]);
		await auth.api.signInDemo({ headers: new Headers() });
		expect(context.adapter.create).toHaveBeenCalledWith(
			expect.objectContaining({
				model: "session",
				data: expect.objectContaining({ activeOrganizationId: user.id }),
			}),
		);
		expect(query).toHaveBeenCalledWith(
			expect.objectContaining({
				sql: expect.stringContaining(
					"insert into `hack_the_andes_organization`",
				),
			}),
			expect.arrayContaining([user.id]),
		);
	});

	it("forbids password account creation for the demo identity", async () => {
		vi.spyOn(database.query.user, "findFirst").mockResolvedValue(user);
		await expect(
			auth.options.databaseHooks.account.create.before({
				id: "credential",
				accountId: user.id,
				createdAt,
				updatedAt: createdAt,
				providerId: "credential",
				userId: user.id,
			}),
		).rejects.toMatchObject({ status: "FORBIDDEN" });
		await expect(
			auth.options.databaseHooks.user.create.before(user, null),
		).rejects.toMatchObject({ status: "FORBIDDEN" });
	});
});
