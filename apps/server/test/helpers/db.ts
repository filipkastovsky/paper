import type { Db } from "@/db/client.js";
import { sql } from "drizzle-orm";

export async function truncateAllTables(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE "portfolios", "refresh_tokens", "users" RESTART IDENTITY CASCADE`,
  );
}
