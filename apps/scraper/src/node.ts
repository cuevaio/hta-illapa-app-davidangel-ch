import {
	SCRAPER_DAILY_CRON,
	SCRAPER_FREQUENT_CRON,
	SCRAPER_HOURLY_CRON,
} from "@hack-the-andes-project/infra/constants";
import {
	scheduleWorker,
	serveWorker,
} from "@hack-the-andes-project/node-runtime/serve";

import worker from "./index";

serveWorker({ worker });
scheduleWorker({
	worker,
	crons: [SCRAPER_FREQUENT_CRON, SCRAPER_HOURLY_CRON, SCRAPER_DAILY_CRON],
});
