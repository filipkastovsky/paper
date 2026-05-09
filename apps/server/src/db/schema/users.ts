import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  handle: text("handle").unique(),
  // Avatar is one of: "peach" | "mint" | "sky" | "lilac". Stored as plain text
  // so adding a 5th option later is a no-op (no enum migration).
  avatar: text("avatar"),
  deviceUuid: text("device_uuid").notNull().unique(),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
