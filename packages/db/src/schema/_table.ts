import { mysqlTableCreator } from "drizzle-orm/mysql-core";

// The `fierros` MySQL database behind the shared `fierro_db` Hyperdrive config
// is used by several projects, each namespacing its tables by prefix.
// drizzle.config.ts scopes push/introspect to this prefix so foreign tables
// are never treated as deleted.
export const TABLE_PREFIX = "hack_the_andes_";

// Outside the `hack_the_andes_*` filter so push/generate never diff it as a
// schema table, yet namespaced so it cannot collide with another project's
// drizzle history in a shared database.
export const MIGRATIONS_TABLE = `__${TABLE_PREFIX}migrations`;

export const mysqlTable = mysqlTableCreator((name) => `${TABLE_PREFIX}${name}`);
