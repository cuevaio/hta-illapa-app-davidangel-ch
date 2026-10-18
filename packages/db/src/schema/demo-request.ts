import { timestamp, varchar } from "drizzle-orm/mysql-core";

import { mysqlTable } from "./_table";
import {
	DEMO_COMPANY_MAX_LENGTH_CHARS,
	DEMO_EMAIL_MAX_LENGTH_CHARS,
	DEMO_NAME_MAX_LENGTH_CHARS,
	DEMO_PHONE_MAX_LENGTH_CHARS,
	ID_LENGTH_CHARS,
	TIMESTAMP_PRECISION_DIGITS,
} from "./constants";

export const demoRequest = mysqlTable("demo_request", {
	id: varchar("id", { length: ID_LENGTH_CHARS }).primaryKey(),
	name: varchar("name", { length: DEMO_NAME_MAX_LENGTH_CHARS }).notNull(),
	company: varchar("company", { length: DEMO_COMPANY_MAX_LENGTH_CHARS }),
	phone: varchar("phone", { length: DEMO_PHONE_MAX_LENGTH_CHARS }),
	email: varchar("email", { length: DEMO_EMAIL_MAX_LENGTH_CHARS }),
	createdAt: timestamp("created_at", { fsp: TIMESTAMP_PRECISION_DIGITS })
		.defaultNow()
		.notNull(),
});
