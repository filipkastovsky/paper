import { type PostgresJsDatabase, drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Db = PostgresJsDatabase<typeof schema>;

export interface DbHandles {
  db: Db;
  sql: postgres.Sql;
}

export interface MakeDbOptions {
  /** Connection pool ceiling. Defaults to 10. Lower for tests where multiple vitest workers share a DB. */
  max?: number;
}

export function makeDb(databaseUrl: string, opts: MakeDbOptions = {}): DbHandles {
  const sql = postgres(databaseUrl, {
    // Disable prepared-statement caching for compatibility with PgBouncer transaction-pool mode.
    // Production deploys may sit behind a pgbouncer-style pooler; this tiny dev-perf cost buys deployment portability.
    prepare: false,
    max: opts.max ?? 10,
  });
  const db = drizzle(sql, { schema, casing: "snake_case" });
  return { db, sql };
}
