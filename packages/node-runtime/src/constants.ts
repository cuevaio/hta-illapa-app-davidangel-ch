export const DEFAULT_HTTP_PORT = 3000;
export const LOOPBACK_HOST = "127.0.0.1";
export const MYSQL_DEFAULT_PORT = 3306;

// Cloudflare Cron Triggers fire in UTC, so the schedules keep that wall clock
// whatever timezone the host runs in.
export const CRON_TIMEZONE = "UTC";

// Above Traefik's 90 s upstream idle timeout: Node must never close a kept-alive
// connection the proxy is about to reuse, or the request surfaces as a 502.
export const HTTP_KEEP_ALIVE_TIMEOUT_MS = 95_000;

export const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];
// Docker sends SIGKILL 10 s after SIGTERM by default; finish draining before.
export const SHUTDOWN_TIMEOUT_MS = 8_000;
