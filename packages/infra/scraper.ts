import "varlock/auto-load";

import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";

import {
	SCRAPER_DAILY_CRON,
	SCRAPER_DEV_PORT,
	SCRAPER_FREQUENT_CRON,
	SCRAPER_HOURLY_CRON,
	SCRAPER_WORKER_NAME,
	WORKER_OBSERVABILITY,
} from "./constants.ts";
import { hyperdriveRef } from "./hyperdrive.ts";
import { serviceVersion } from "./server.ts";

export const scraper = Cloudflare.Worker("scraper", {
	name: SCRAPER_WORKER_NAME,
	main: "../../apps/scraper/src/index.ts",
	compatibility: {
		flags: ["nodejs_compat"],
	},
	observability: WORKER_OBSERVABILITY,
	crons: [SCRAPER_FREQUENT_CRON, SCRAPER_HOURLY_CRON, SCRAPER_DAILY_CRON],
	env: {
		HYPERDRIVE: hyperdriveRef(),
		SELF: Cloudflare.Workers.Self,
		APP_ENV: Config.String("APP_ENV"),
		SCRAPER_RUN_SECRET: Config.Redacted("SCRAPER_RUN_SECRET"),
		JEV_API_KEY: Config.Redacted("JEV_API_KEY"),
		B2_MEDIA_KEY_ID: Config.Redacted("B2_MEDIA_KEY_ID"),
		B2_MEDIA_APPLICATION_KEY: Config.Redacted("B2_MEDIA_APPLICATION_KEY"),
		// Unset means the Worker calls SRATMA directly, which Cloudflare's egress can.
		...(process.env.SRATMA_RELAY_URL
			? { SRATMA_RELAY_URL: Config.String("SRATMA_RELAY_URL") }
			: {}),
		SERVICE_VERSION: serviceVersion,
	},
	dev: {
		port: SCRAPER_DEV_PORT,
	},
});

export type ScraperEnv = Cloudflare.InferEnv<typeof scraper>;
