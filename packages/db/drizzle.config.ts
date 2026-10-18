import "varlock/auto-load";
import { defineConfig } from "drizzle-kit";
import { ENV } from "./src/env";
import { MIGRATIONS_TABLE, TABLE_PREFIX } from "./src/schema/_table";

// drizzle-kit runs in Node, outside the Worker, so it cannot read the
// Hyperdrive binding — it connects straight to the database via DATABASE_URL.
export default defineConfig({
	schema: "./src/schema/index.ts",
	out: "./src/migrations",
	dialect: "mysql",
	tablesFilter: [`${TABLE_PREFIX}*`],
	migrations: { table: MIGRATIONS_TABLE },
	dbCredentials: {
		url: ENV.DATABASE_URL,
	},
});
