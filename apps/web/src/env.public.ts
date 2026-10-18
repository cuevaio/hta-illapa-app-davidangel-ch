import type { PublicCoercedEnvSchema } from "./env";

const serverUrl = import.meta.env.VITE_SERVER_URL;
if (!serverUrl) {
	throw new Error(
		"VITE_SERVER_URL is required; set the API URL before building the dashboard",
	);
}

export const ENV = {
	VITE_SERVER_URL: serverUrl,
} satisfies Pick<PublicCoercedEnvSchema, "VITE_SERVER_URL">;
