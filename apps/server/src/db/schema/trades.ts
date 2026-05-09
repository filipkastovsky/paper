import { sql } from "drizzle-orm";
import {
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * Per spec §8.2:
 *   Trade — id, user_id, asset_id, side ∈ {buy, sell}, usd_amount, qty,
 *           price_at_execution, idempotency_key (per-user unique), created_at
 *
 * `qty`, `usd_amount`, `price_at_execution` are numeric(20,8) — Postgres NUMERIC
 * round-trips as `string` in postgres.js / Drizzle. Trade math always uses
 * `Decimal`, never JS `number`.
 *
 * The `(user_id, idempotency_key)` unique index is the load-bearing piece of
 * the idempotency contract: a retry POST with the same key trips SQLSTATE 23505,
 * which the route handler catches and remaps to "return the existing row".
 */
export const tradeSide = pgEnum("trade_side", ["buy", "sell"]);

export const trades = pgTable(
  "trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assetId: text("asset_id").notNull(),
    side: tradeSide("side").notNull(),
    usdAmount: numeric("usd_amount", { precision: 20, scale: 8 }).notNull(),
    qty: numeric("qty", { precision: 20, scale: 8 }).notNull(),
    priceAtExecution: numeric("price_at_execution", { precision: 20, scale: 8 }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    byUserCreatedAt: index("trades_user_id_created_at_idx").on(t.userId, t.createdAt),
    uniqByUserAndKey: uniqueIndex("trades_user_id_idempotency_key_uq").on(
      t.userId,
      t.idempotencyKey,
    ),
  }),
);

export type Trade = typeof trades.$inferSelect;
export type NewTrade = typeof trades.$inferInsert;
export type TradeSide = (typeof tradeSide.enumValues)[number];
