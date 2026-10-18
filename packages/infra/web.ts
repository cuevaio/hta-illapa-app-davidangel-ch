import "varlock/auto-load";

import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";

import {
	WEB_DEV_PORT,
	WEB_DOMAIN,
	WEB_WORKER_NAME,
	WORKER_OBSERVABILITY,
} from "./constants.ts";

// VITE_SERVER_URL comes from apps/web/.env(.production) instead of the server
// Worker's output on purpose: web never depends on server in the graph.
export const web = Cloudflare.Website.Vite("web", {
	name: WEB_WORKER_NAME,
	workersDev: true,
	rootDir: "../../apps/web",
	domain: {
		name: WEB_DOMAIN,
	},
	assets: {
		htmlHandling: "auto-trailing-slash",
		notFoundHandling: "single-page-application",
	},
	observability: WORKER_OBSERVABILITY,
	env: {
		VITE_SERVER_URL: Config.String("VITE_SERVER_URL"),
	},
	dev: {
		port: WEB_DEV_PORT,
	},
});
