import { DEMO_RESET_PATH } from "@hack-the-andes-project/business/demo-account";
import { DEMO_REQUESTS_PATH } from "@hack-the-andes-project/business/demo-request";

export const SERVICE_NAME = "hack-the-andes-server";

// Browsers cap Access-Control-Max-Age; ask for the 24h upper bound so
// preflights are reused as long as each browser allows.
export const CORS_PREFLIGHT_MAX_AGE_S = 86_400;

export const RPC_PREFIX = "/rpc";
export const AUTH_PREFIX = "/api/auth";
export const MAX_REQUEST_BODY_BYTES = 1_048_576;
export const DEMO_REQUEST_RATE_LIMIT_MAX_REQUESTS = 5;
export const DEMO_REQUEST_RATE_LIMIT_WINDOW_MS = 600_000;
export const HTTP_STATUS_FORBIDDEN = 403;
export const HTTP_STATUS_PAYLOAD_TOO_LARGE = 413;
export const HTTP_STATUS_TOO_MANY_REQUESTS = 429;

export const PUBLIC_PATHS: ReadonlySet<string> = new Set([
	"/",
	DEMO_RESET_PATH,
	DEMO_REQUESTS_PATH,
]);
