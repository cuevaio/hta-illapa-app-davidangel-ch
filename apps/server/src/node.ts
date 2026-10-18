import { serveWorker } from "@hack-the-andes-project/node-runtime/serve";

import worker from "./index";

serveWorker({ worker });
