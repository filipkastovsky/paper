import { date, numeric, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * One row per user per UTC date. Written by the daily-snapshot CronJob
 * (`0 0 * * *`) and back-filled lazily on first-trade-of-day so a user
 * created mid-day still has a baseline for "% today".
 *
 * `(user_id, snapshot_date)` is the composite PK — duplicate inserts trip
 * SQLSTATE 23505, which `ensureTodaySnapshot` swallows.
 */
export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    snapshotDate: date("snapshot_date", { mode: "string" }).notNull(),
    totalValueUsd: numeric("total_value_usd", { precision: 20, scale: 8 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.snapshotDate] }),
  }),
);

export type PortfolioSnapshot = typeof portfolioSnapshots.$inferSelect;
export type NewPortfolioSnapshot = typeof portfolioSnapshots.$inferInsert;
