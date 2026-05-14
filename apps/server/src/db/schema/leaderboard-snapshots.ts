import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * One row per user, upserted every 5 minutes by the leaderboard-recompute CronJob.
 * `week_starting_date` is the ISO date (YYYY-MM-DD) of the Sunday that starts the
 * current leaderboard week. All rows in the table belong to the same week; on
 * Sunday 00:00 UTC the weekly-reset job deletes all rows and the recompute job
 * immediately repopulates for the new week.
 *
 * `composite_score` = FLOOR((total_val - 10000) / 10000 * 100) + lessons * 5 + streak_days
 * `rank_global` = RANK() OVER (ORDER BY composite_score DESC)
 *
 * PK is user_id so ON CONFLICT (user_id) DO UPDATE is a simple upsert.
 */
export const leaderboardSnapshots = pgTable("leaderboard_snapshots", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  weekStartingDate: text("week_starting_date").notNull(),
  compositeScore: integer("composite_score").notNull().default(0),
  rankGlobal: integer("rank_global").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LeaderboardSnapshot = typeof leaderboardSnapshots.$inferSelect;
export type NewLeaderboardSnapshot = typeof leaderboardSnapshots.$inferInsert;
