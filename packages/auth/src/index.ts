import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { expo } from "@better-auth/expo";
import { MIN_PASSWORD_LENGTH_CHARS } from "@hack-the-andes-project/business/constants";
import {
	DEMO_SIGN_IN_AUTH_PATH,
	isDemoAccountEmail,
} from "@hack-the-andes-project/business/demo-account";
import type { Database } from "@hack-the-andes-project/db";
import * as schema from "@hack-the-andes-project/db/schema/auth";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { organization } from "better-auth/plugins";

import {
	DEMO_CHANGE_FORBIDDEN_MESSAGE,
	EXPO_DEV_ORIGINS,
	NATIVE_APP_SCHEME_ORIGIN,
	RATE_LIMIT_MAX_REQUESTS,
	RATE_LIMIT_WINDOW_S,
	SESSION_COOKIE_CACHE_MAX_AGE_S,
	SIGN_IN_RATE_LIMIT_MAX_REQUESTS,
	SIGN_UP_RATE_LIMIT_MAX_REQUESTS,
} from "./constants";
import { demoAccess } from "./demo";
import { ensurePersonalOrganization } from "./organization";
import { parseAllowedOrigins } from "./origins";
import { hashPassword, verifyPassword } from "./password";

export { createOriginMatcher, parseAllowedOrigins } from "./origins";

export interface AuthConfig {
	BETTER_AUTH_URL: string;
	BETTER_AUTH_SECRET: string;
	ALLOWED_ORIGINS: string;
	CLIENT_IP_HEADER: string;
}

export function createAuth(env: AuthConfig, database: Database) {
	const isLocalServer = env.BETTER_AUTH_URL.startsWith("http://localhost");

	return betterAuth({
		database: drizzleAdapter(database, {
			provider: "mysql",
			schema,
		}),
		trustedOrigins: [
			...parseAllowedOrigins(env.ALLOWED_ORIGINS),
			NATIVE_APP_SCHEME_ORIGIN,
			// Expo Go and the Metro dev server only exist against a local server.
			...(isLocalServer ? EXPO_DEV_ORIGINS : []),
		],
		emailAndPassword: {
			enabled: true,
			minPasswordLength: MIN_PASSWORD_LENGTH_CHARS,
			password: { hash: hashPassword, verify: verifyPassword },
		},
		user: {
			additionalFields: {
				role: {
					type: [...schema.USER_ROLES],
					defaultValue: schema.DEFAULT_USER_ROLE,
					input: false,
				},
			},
		},
		session: {
			cookieCache: {
				enabled: true,
				maxAge: SESSION_COOKIE_CACHE_MAX_AGE_S,
			},
		},
		databaseHooks: {
			user: {
				create: {
					before: async (user, context) => {
						if (
							isDemoAccountEmail(user.email) &&
							context?.path !== DEMO_SIGN_IN_AUTH_PATH
						) {
							throw new APIError("FORBIDDEN", {
								message: DEMO_CHANGE_FORBIDDEN_MESSAGE,
							});
						}
					},
					after: async (user) => {
						await ensurePersonalOrganization(database, user);
					},
				},
			},
			account: {
				create: {
					before: async (account) => {
						if (account.providerId !== "credential") return;
						const user = await database.query.user.findFirst({
							where: { id: account.userId },
						});
						if (isDemoAccountEmail(user?.email))
							throw new APIError("FORBIDDEN", {
								message: DEMO_CHANGE_FORBIDDEN_MESSAGE,
							});
					},
				},
			},
			session: {
				create: {
					before: async (session) => {
						if (session.activeOrganizationId) return;

						const firstMembership = await database.query.member.findFirst({
							where: { userId: session.userId },
							orderBy: { createdAt: "asc", id: "asc" },
						});
						if (firstMembership) {
							return {
								data: {
									...session,
									activeOrganizationId: firstMembership.organizationId,
								},
							};
						}

						// Better Auth 1.7.7 defers user.create.after until after sign-up's
						// first session, so both hooks must be able to provision safely.
						const user = await database.query.user.findFirst({
							where: { id: session.userId },
						});
						if (!user) return;

						const organizationId = await ensurePersonalOrganization(
							database,
							user,
						);
						return {
							data: { ...session, activeOrganizationId: organizationId },
						};
					},
				},
			},
		},
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		rateLimit: {
			enabled: true,
			// Workers keep no memory between isolates, so counters live in MySQL.
			storage: "database",
			window: RATE_LIMIT_WINDOW_S,
			max: RATE_LIMIT_MAX_REQUESTS,
			customRules: {
				// Every guarded request already resolves the session through
				// auth.api.getSession, which is not rate limited; the limiter's own
				// bookkeeping would cost more than the lookup it guards.
				"/get-session": false,
				"/sign-in/email": {
					window: RATE_LIMIT_WINDOW_S,
					max: SIGN_IN_RATE_LIMIT_MAX_REQUESTS,
				},
				"/sign-up/email": {
					window: RATE_LIMIT_WINDOW_S,
					max: SIGN_UP_RATE_LIMIT_MAX_REQUESTS,
				},
			},
		},
		advanced: {
			// SPA and API live on different origins, so cookies must be cross-site.
			defaultCookieAttributes: {
				sameSite: "none",
				secure: true,
				httpOnly: true,
			},
			// better-auth defaults to x-forwarded-for and drops multi-hop values,
			// which would collapse every client into one shared rate-limit bucket.
			// CLIENT_IP_HEADER is set by the edge proxy itself (Cloudflare's
			// cf-connecting-ip, Traefik's x-real-ip), so clients cannot spoof it.
			ipAddress: {
				ipAddressHeaders: [env.CLIENT_IP_HEADER],
			},
		},
		plugins: [expo(), organization(), demoAccess],
	});
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Awaited<ReturnType<Auth["api"]["getSession"]>>;
