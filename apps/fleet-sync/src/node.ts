import { FLEET_SYNC_CRON } from "@hack-the-andes-project/infra/constants";
import {
	scheduleWorker,
	serveWorker,
} from "@hack-the-andes-project/node-runtime/serve";

import worker from "./index";

serveWorker({ worker });
scheduleWorker({ worker, crons: [FLEET_SYNC_CRON] });
