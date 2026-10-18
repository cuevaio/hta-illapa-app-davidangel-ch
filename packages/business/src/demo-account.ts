import type { UserRole } from "@hack-the-andes-project/db/schema/auth";

export const DEMO_ACCOUNT_EMAIL = "demo@illapa.app";
export const DEMO_ACCOUNT_ROLE: UserRole = "fleet";
export const DEMO_ACCOUNT_NAME = "Demo ILLAPA";
// Relative to better-auth's /api/auth base path.
export const DEMO_SIGN_IN_AUTH_PATH = "/demo/sign-in";
export const DEMO_RESET_PATH = "/api/demo/reset";
export const DEMO_RESET_SECRET_HEADER = "x-demo-reset-secret";

export function isDemoAccountEmail(email: string | null | undefined) {
	return email === DEMO_ACCOUNT_EMAIL;
}
