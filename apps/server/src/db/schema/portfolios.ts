import { jsonb, numeric, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * Per spec §8.2:
 *   Portfolio — user_id, cash_usd, holdings: {asset_id: {qty, cost_basis}}; starting cash $10,000
 *
 * cash_usd and holdings.{*}.qty / cost_basis are numeric(20,8) — Postgres NUMERIC
 * round-trips as `string` in postgres.js / Drizzle. Use `decimal.js` (added in Task 4)
 * for arithmetic.
 */
export type HoldingsJson = Record<string, { qty: string; cost_basis: string }>;

export const portfolios = pgTable("portfolios", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  cashUsd: numeric("cash_usd", { precision: 20, scale: 8 }).notNull().default("10000"),
  holdings: jsonb("holdings").notNull().default({}).$type<HoldingsJson>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Portfolio = typeof portfolios.$inferSelect;
export type NewPortfolio = typeof portfolios.$inferInsert;
