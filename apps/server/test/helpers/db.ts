import type { Db } from "@/db/client.js";
import { sql } from "drizzle-orm";

export async function truncateAllTables(db: Db): Promise<void> {
  // Order matters via FK chain: trades + portfolio_snapshots + portfolios + refresh_tokens → users.
  // CASCADE handles the FK chain regardless of list order; we still spell out every table to keep
  // the test fixture aware of the full schema (CI fails fast if a new table forgets to add itself).
  await db.execute(
    sql`TRUNCATE TABLE "trades", "portfolio_snapshots", "portfolios", "refresh_tokens", "lesson_progress", "streaks", "users" RESTART IDENTITY CASCADE`,
  );
}
