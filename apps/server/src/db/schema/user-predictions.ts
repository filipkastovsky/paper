import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { dailyQuestions } from "./daily-questions.js";
import { users } from "./users.js";

export const userPredictions = pgTable(
  "user_predictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dailyQuestionId: uuid("daily_question_id")
      .notNull()
      .references(() => dailyQuestions.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(),
    stake: integer("stake").notNull(),
    status: text("status").notNull().default("pending"),
    payout: integer("payout"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqUserQuestion: uniqueIndex("user_predictions_user_question_uq").on(
      t.userId,
      t.dailyQuestionId,
    ),
    byUser: index("user_predictions_user_id_idx").on(t.userId),
  }),
);

export type UserPrediction = typeof userPredictions.$inferSelect;
export type NewUserPrediction = typeof userPredictions.$inferInsert;
