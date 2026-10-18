import type { UserRole } from "@hack-the-andes-project/db/schema/auth";

export const DEMO_ACCOUNT_EMAIL = "demo@illapa.app";
export const DEMO_ACCOUNT_ROLE: UserRole = "fleet";
export const DEMO_ACCOUNT_NAME = "Demo ILLAPA";
export const ENGINEER_DEMO_ACCOUNT_EMAIL = "demo-ingenieria@illapa.app";
export const ENGINEER_DEMO_ACCOUNT_ROLE: UserRole = "engineer";
export const ENGINEER_DEMO_ACCOUNT_NAME = "Demo Ingeniería ILLAPA";
// Relative to better-auth's /api/auth base path.
export const DEMO_SIGN_IN_AUTH_PATH = "/demo/sign-in";
export const DEMO_RESET_PATH = "/api/demo/reset";
export const DEMO_RESET_SECRET_HEADER = "x-demo-reset-secret";

export const DEMO_PROFILES = ["fleet", "engineer"] as const;
export type DemoProfile = (typeof DEMO_PROFILES)[number];
export const DEFAULT_DEMO_PROFILE: DemoProfile = "fleet";

export interface DemoAccount {
	email: string;
	name: string;
	role: UserRole;
}

export const DEMO_ACCOUNTS: Record<DemoProfile, DemoAccount> = {
	fleet: {
		email: DEMO_ACCOUNT_EMAIL,
		name: DEMO_ACCOUNT_NAME,
		role: DEMO_ACCOUNT_ROLE,
	},
	engineer: {
		email: ENGINEER_DEMO_ACCOUNT_EMAIL,
		name: ENGINEER_DEMO_ACCOUNT_NAME,
		role: ENGINEER_DEMO_ACCOUNT_ROLE,
	},
};

export function isDemoAccountEmail(email: string | null | undefined) {
	return Object.values(DEMO_ACCOUNTS).some(
		(demoAccount) => demoAccount.email === email,
	);
}
