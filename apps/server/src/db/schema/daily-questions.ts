import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const dailyQuestions = pgTable(
  "daily_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: text("date").notNull(),
    assetId: text("asset_id").notNull(),
    baselinePriceUsd: text("baseline_price_usd").notNull(),
    directionResolved: text("direction_resolved"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqDate: uniqueIndex("daily_questions_date_uq").on(t.date),
  }),
);

export type DailyQuestion = typeof dailyQuestions.$inferSelect;
export type NewDailyQuestion = typeof dailyQuestions.$inferInsert;
