import { integer, pgTable, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const predictionPoints = pgTable("prediction_points", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  balance: integer("balance").notNull().default(1000),
});

export type PredictionPoints = typeof predictionPoints.$inferSelect;
