import { join } from "node:path";
import { migrateDatabase } from "@hack-the-andes-project/db/migrate";
import { serveWorker } from "@hack-the-andes-project/node-runtime/serve";

import { ENV } from "./env.server";
import worker from "./index";

// Only the server migrates, and before it listens, so a deploy never serves
// code against a schema it has not applied yet. scraper and fleet-sync share
// the database and deploy alongside it.
await migrateDatabase(
	ENV.HYPERDRIVE.connectionString,
	join(import.meta.dirname, "migrations"),
);

serveWorker({ worker });
