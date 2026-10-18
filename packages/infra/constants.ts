import type * as Cloudflare from "alchemy/Cloudflare";

// Existing Hyperdrive config in the personal Cloudflare account, shared by
// every project that lives in the `fierros` MySQL database on vero.
export const HYPERDRIVE_CONFIG_ID = "8615b8a17bec436a9b2caf5664fa6484";
export const HYPERDRIVE_CONFIG_NAME = "fierro_db";
export const MYSQL_DEFAULT_PORT = 3306;

export const SERVER_DEV_PORT = 3000;
export const WEB_DEV_PORT = 3001;
export const SERVER_WORKER_NAME = "hack-the-andes-server";
export const WEB_WORKER_NAME = "hack-the-andes-web";
export const API_DOMAIN = "api.illapa.app";
export const WEB_DOMAIN = "dash.illapa.app";
export const ILLAPA_WORKER_NAME = "hack-the-andes-illapa";
export const ILLAPA_DOMAIN = "illapa.app";

export const SCRAPER_DEV_PORT = 3002;
export const SCRAPER_WORKER_NAME = "hack-the-andes-scraper";
// Incident feeds every 5 minutes; news listings hourly; reference directories
// (alt routes, fire stations, terminals...) once a day at 09:00 UTC (04:00 Lima).
export const SCRAPER_FREQUENT_CRON = "*/5 * * * *";
export const SCRAPER_HOURLY_CRON = "0 * * * *";
export const SCRAPER_DAILY_CRON = "0 9 * * *";

export const FLEET_SYNC_DEV_PORT = 3003;
export const FLEET_SYNC_WORKER_NAME = "hack-the-andes-fleet-sync";
export const FLEET_SYNC_CRON = "*/2 * * * *";

// Workers Logs keeps the evlog wide events and stamps each invocation with its
// cpuTime/wallTime (what the Free plan's 10 ms CPU limit kills on); traces add
// the per-request waterfall and Issues groups uncaught exceptions.
export const WORKER_OBSERVABILITY: Cloudflare.WorkerObservability = {
	enabled: true,
	headSamplingRate: 1,
	logs: {
		enabled: true,
		invocationLogs: true,
		headSamplingRate: 1,
		persist: true,
	},
	traces: { enabled: true, headSamplingRate: 1, persist: true },
};
