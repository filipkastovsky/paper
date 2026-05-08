import { type PostgresJsDatabase, drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Db = PostgresJsDatabase<typeof schema>;

export interface DbHandles {
  db: Db;
  sql: postgres.Sql;
}

export function makeDb(databaseUrl: string): DbHandles {
  const sql = postgres(databaseUrl, { prepare: false, max: 10 });
  const db = drizzle(sql, { schema, casing: "snake_case" });
  return { db, sql };
}
