import {
	type DatabaseConnectionConfig,
	createDb as openDatabase,
} from "@hack-the-andes-project/db/index";

import { onInvocationFinished, reportFailure } from "./execution-context";

export * from "@hack-the-andes-project/db/index";

// Replaces createDb in the Node bundles. workerd closes the sockets a request
// opened when it ends; Node keeps them open, so the per-request connection is
// closed with its invocation or it leaks against the shared MySQL. Without an
// error listener, an idle connection dropped by the server would crash the
// process.
export async function createDb(config: DatabaseConnectionConfig) {
	const database = await openDatabase(config);
	database.$client.on("error", (error) =>
		reportFailure(error, { failedIn: "database_connection" }),
	);
	onInvocationFinished(() => database.$client.end());
	return database;
}
