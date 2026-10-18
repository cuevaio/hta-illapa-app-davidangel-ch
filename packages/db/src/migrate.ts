import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";

import { MIGRATIONS_TABLE } from "./schema/_table";

export async function migrateDatabase(
	databaseUrl: string,
	migrationsFolder: string,
) {
	const connection = await mysql.createConnection(databaseUrl);
	try {
		await migrate(drizzle({ client: connection }), {
			migrationsFolder,
			migrationsTable: MIGRATIONS_TABLE,
		});
	} finally {
		await connection.end();
	}
}
