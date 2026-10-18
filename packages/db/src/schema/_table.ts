import { mysqlTableCreator } from "drizzle-orm/mysql-core";

// Production and staging use separate MySQL databases on Dokploy.
// Keep the table prefix so existing tables retain their names.
// drizzle.config.ts scopes push/introspect to this prefix so foreign tables
// are never treated as deleted.
export const TABLE_PREFIX = "hack_the_andes_";

// Outside the `hack_the_andes_*` filter so push/generate never diff it as a
// schema table, yet namespaced so it cannot collide with another project's
// drizzle history in a shared database.
export const MIGRATIONS_TABLE = `__${TABLE_PREFIX}migrations`;

export const mysqlTable = mysqlTableCreator((name) => `${TABLE_PREFIX}${name}`);
