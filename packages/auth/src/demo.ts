import {
	DEFAULT_DEMO_PROFILE,
	DEMO_ACCOUNTS,
	DEMO_PROFILES,
	DEMO_SIGN_IN_AUTH_PATH,
	isDemoAccountEmail,
} from "@hack-the-andes-project/business/demo-account";
import type { BetterAuthPlugin } from "better-auth";
import {
	APIError,
	createAuthEndpoint,
	createAuthMiddleware,
	getSessionFromCtx,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

import {
	DEMO_BLOCKED_AUTH_PATHS,
	DEMO_CHANGE_FORBIDDEN_MESSAGE,
	DEMO_RATE_LIMIT_MAX_REQUESTS,
	DEMO_RATE_LIMIT_WINDOW_S,
	DEMO_SESSION_CONFLICT_MESSAGE,
} from "./constants";

export interface DemoAuthPathContext {
	path?: string;
}

export const demoAccess = {
	id: "demo-access",
	endpoints: {
		signInDemo: createAuthEndpoint(
			DEMO_SIGN_IN_AUTH_PATH,
			{
				method: "POST",
				body: z
					.object({ profile: z.enum(DEMO_PROFILES).optional() })
					.optional(),
			},
			async (context) => {
				const demoAccount =
					DEMO_ACCOUNTS[context.body?.profile ?? DEFAULT_DEMO_PROFILE];
				const adapter = context.context.internalAdapter;
				// Not getSessionFromCtx: it reports a failed lookup as signed out and
				// writes session cookies, which better-auth also sends with the 409.
				const sessionToken = await context.getSignedCookie(
					context.context.authCookies.sessionToken.name,
					context.context.secret,
				);
				const currentSession = sessionToken
					? await adapter.findSession(sessionToken)
					: null;
				if (currentSession && currentSession.session.expiresAt > new Date()) {
					if (!isDemoAccountEmail(currentSession.user.email))
						throw new APIError("CONFLICT", {
							message: DEMO_SESSION_CONFLICT_MESSAGE,
						});
					if (currentSession.user.email === demoAccount.email) {
						// The server guard refreshes the session row but drops its Set-Cookie,
						// so a reused demo session must re-issue the 7-day cookie here.
						await setSessionCookie(context, currentSession);
						return context.json({ success: true });
					}
					await adapter.deleteSession(currentSession.session.token);
				}
				let user = (await adapter.findUserByEmail(demoAccount.email))?.user;
				if (!user) {
					try {
						user = await adapter.createUser(
							{
								email: demoAccount.email,
								name: demoAccount.name,
								emailVerified: true,
								role: demoAccount.role,
							},
							{ method: "demo" },
						);
					} catch (error) {
						user = (await adapter.findUserByEmail(demoAccount.email))?.user;
						if (!user) throw error;
					}
				}
				const session = await adapter.createSession(user.id);
				if (!session)
					throw new APIError("INTERNAL_SERVER_ERROR", {
						message: "No se pudo iniciar la demo.",
					});
				await setSessionCookie(context, { user, session });
				return context.json({ success: true });
			},
		),
	},
	hooks: {
		before: [
			{
				matcher: (context: DemoAuthPathContext) =>
					Boolean(context.path && DEMO_BLOCKED_AUTH_PATHS.has(context.path)),
				handler: createAuthMiddleware(async (context) => {
					const session = await getSessionFromCtx(context);
					if (isDemoAccountEmail(session?.user.email)) {
						throw new APIError("FORBIDDEN", {
							message: DEMO_CHANGE_FORBIDDEN_MESSAGE,
						});
					}
				}),
			},
		],
	},
	rateLimit: [
		{
			pathMatcher: (path) => path === DEMO_SIGN_IN_AUTH_PATH,
			window: DEMO_RATE_LIMIT_WINDOW_S,
			max: DEMO_RATE_LIMIT_MAX_REQUESTS,
		},
	],
} satisfies BetterAuthPlugin;
