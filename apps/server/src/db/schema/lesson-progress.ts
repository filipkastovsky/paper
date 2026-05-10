import { index, pgTable, primaryKey, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * One row per (user, lesson) pair. The composite PK absorbs concurrent
 * upserts; the service uses onConflictDoUpdate with GREATEST(quiz_score, new)
 * so re-completing with a higher score raises it, never lowers it.
 *
 * `completed_at` is set on the first insert and NEVER changes. `updated_at`
 * tracks the most recent quiz_score update.
 */
export const lessonProgress = pgTable(
  "lesson_progress",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lessonId: text("lesson_id").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
    quizScore: smallint("quiz_score").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.lessonId] }),
    byUserCompletedAt: index("lesson_progress_user_completed_at_idx").on(
      t.userId,
      t.completedAt.desc(),
    ),
  }),
);

export type LessonProgress = typeof lessonProgress.$inferSelect;
export type NewLessonProgress = typeof lessonProgress.$inferInsert;
