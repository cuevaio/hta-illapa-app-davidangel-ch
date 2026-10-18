import type { PublicCoercedEnvSchema } from "./env";

export const ENV = {
	PUBLIC_APP_URL: import.meta.env.PUBLIC_APP_URL,
	PUBLIC_API_URL: import.meta.env.PUBLIC_API_URL,
} satisfies Pick<PublicCoercedEnvSchema, "PUBLIC_APP_URL" | "PUBLIC_API_URL">;
