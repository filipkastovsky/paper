import type { Db } from "@/db/client.js";
import {
  type HoldingsJson,
  type Trade,
  type TradeSide,
  portfolios,
  trades,
} from "@/db/schema/index.js";
import { ASSETS, isAssetId } from "@paper/shared";
import { Decimal } from "decimal.js";
import { and, desc, eq } from "drizzle-orm";
import { getCachedPrice } from "./prices.js";

export type ExecuteTradeInput = {
  userId: string;
  assetId: string;
  side: TradeSide;
  /** USD amount as a numeric(20,8)-formatted string. */
  usdAmount: string;
  /** Per-user unique key. The DB trips 23505 on retries; we remap to a hit. */
  idempotencyKey: string;
};

export type ExecuteTradeError =
  | "insufficient_cash"
  | "insufficient_qty"
  | "unknown_asset"
  | "price_unavailable"
  | "invalid_amount";

export type ExecuteTradeResult =
  | { kind: "ok"; trade: Trade; isFirstTrade: boolean; wasIdempotentReplay: boolean }
  | { kind: "error"; code: ExecuteTradeError };

const QTY_DP = 8;

/**
 * Execute one trade. Server-authoritative pricing — we re-read the cached
 * price (Redis, written by the per-minute cron, TTL 120s) inside the call
 * and refuse to trade if it's missing. Re-runs with the same idempotencyKey
 * return the original Trade row without mutating state.
 */
export async function executeTrade(
  db: Db,
  redisUrl: string,
  input: ExecuteTradeInput,
): Promise<ExecuteTradeResult> {
  if (!isAssetId(input.assetId)) {
    return { kind: "error", code: "unknown_asset" };
  }

  const usdAmountDec = new Decimal(input.usdAmount);
  if (!usdAmountDec.isFinite() || usdAmountDec.lte(0)) {
    return { kind: "error", code: "invalid_amount" };
  }

  const cached = await getCachedPrice(redisUrl, input.assetId);
  if (!cached || cached.usd <= 0) {
    return { kind: "error", code: "price_unavailable" };
  }
  const priceDec = new Decimal(cached.usd);
  // 8-decimal qty per spec §8.2. ROUND_DOWN means the user never gets MORE qty
  // than they paid for; the rounding scrap is absorbed by the trade row.
  const qtyDec = usdAmountDec.div(priceDec).toDecimalPlaces(QTY_DP, Decimal.ROUND_DOWN);
  if (qtyDec.lte(0)) {
    // Pathological tiny order: $0.00000001 / $50,000 rounds to 0.
    return { kind: "error", code: "invalid_amount" };
  }
  // Both sides of the trade must agree: cash moved == qty * price. If we used the
  // requested usdAmount on either side, the rounding scrap from `qtyDec` would
  // leak (a sell would credit more cash than the qty surrendered, a buy would
  // debit more than the qty acquired). Compute the actual transaction value
  // ROUND_DOWN to the same 8dp the qty uses, and use it for both the trade row
  // and the cash mutation.
  const actualUsdDec = qtyDec.mul(priceDec).toDecimalPlaces(QTY_DP, Decimal.ROUND_DOWN);

  try {
    const out = await db.transaction(async (tx) => {
      const [pf] = await tx
        .select()
        .from(portfolios)
        .where(eq(portfolios.userId, input.userId))
        .for("update");
      if (!pf) throw new Error("portfolio missing for authenticated user");

      const cashDec = new Decimal(pf.cashUsd);
      const holdings = pf.holdings as HoldingsJson;
      const existing = holdings[input.assetId];

      let nextCash: Decimal;
      let nextHoldings: HoldingsJson;

      if (input.side === "buy") {
        // Check against the actual debit, not the user-requested amount, so a
        // user with exactly enough cash for the truncated trade can still buy.
        if (cashDec.lt(actualUsdDec)) {
          // Bail with a sentinel — Drizzle rolls back on throw.
          throw new TradeError("insufficient_cash");
        }
        nextCash = cashDec.minus(actualUsdDec);
        const prevQty = new Decimal(existing?.qty ?? "0");
        const prevCost = new Decimal(existing?.cost_basis ?? "0");
        const prevValue = prevQty.mul(prevCost);
        const newQty = prevQty.plus(qtyDec);
        // Weighted-average cost basis. If newQty is 0 (impossible on buy), fall back to price.
        const newCost = newQty.gt(0) ? prevValue.plus(actualUsdDec).div(newQty) : priceDec;
        nextHoldings = {
          ...holdings,
          [input.assetId]: {
            qty: newQty.toFixed(QTY_DP),
            cost_basis: newCost.toDecimalPlaces(QTY_DP, Decimal.ROUND_HALF_UP).toFixed(QTY_DP),
          },
        };
      } else {
        const prevQty = new Decimal(existing?.qty ?? "0");
        if (prevQty.lt(qtyDec)) {
          throw new TradeError("insufficient_qty");
        }
        nextCash = cashDec.plus(actualUsdDec);
        const newQty = prevQty.minus(qtyDec);
        if (newQty.lte(0)) {
          // Drop the entry entirely so /v1/me + the dashboard hide closed positions.
          const { [input.assetId]: _drop, ...rest } = holdings;
          nextHoldings = rest;
        } else {
          // cost_basis on a partial sell stays the same — the average cost of the
          // remaining qty hasn't changed.
          nextHoldings = {
            ...holdings,
            [input.assetId]: {
              qty: newQty.toFixed(QTY_DP),
              cost_basis: existing?.cost_basis ?? priceDec.toFixed(QTY_DP),
            },
          };
        }
      }

      let inserted: Trade;
      try {
        const rows = await tx
          .insert(trades)
          .values({
            userId: input.userId,
            assetId: input.assetId,
            side: input.side,
            // Persist the EXECUTED amount (qty * price), not the user request.
            // Keeps the row internally consistent: usdAmount === qty * priceAtExecution.
            usdAmount: actualUsdDec.toFixed(QTY_DP),
            qty: qtyDec.toFixed(QTY_DP),
            priceAtExecution: priceDec.toFixed(QTY_DP),
            idempotencyKey: input.idempotencyKey,
          })
          .returning();
        // biome-ignore lint/style/noNonNullAssertion: .returning() guarantees a row when insert succeeds
        inserted = rows[0]!;
      } catch (err) {
        // Idempotency hit. Aborting the inner tx and looking up the existing row
        // outside it keeps the trade insert + portfolio update as a single atomic
        // unit — we never want a half-applied retry.
        if (
          err !== null &&
          typeof err === "object" &&
          "code" in err &&
          (err as { code: string }).code === "23505"
        ) {
          throw new IdempotencyHit();
        }
        throw err;
      }

      await tx
        .update(portfolios)
        .set({
          cashUsd: nextCash.toFixed(QTY_DP),
          holdings: nextHoldings,
        })
        .where(eq(portfolios.userId, input.userId));

      return inserted;
    });

    // First-trade detection: count(trades where user=X) == 1 post-insert. Cheap
    // because the index `trades_user_id_created_at_idx` covers it.
    const tradeCount = await countUserTrades(db, input.userId);
    return { kind: "ok", trade: out, isFirstTrade: tradeCount === 1, wasIdempotentReplay: false };
  } catch (err) {
    if (err instanceof TradeError) {
      return { kind: "error", code: err.code };
    }
    if (err instanceof IdempotencyHit) {
      const [existing] = await db
        .select()
        .from(trades)
        .where(
          and(eq(trades.userId, input.userId), eq(trades.idempotencyKey, input.idempotencyKey)),
        );
      if (!existing) {
        // Should never happen — the unique violation guarantees a row exists.
        throw new Error("idempotency hit but row missing");
      }
      return { kind: "ok", trade: existing, isFirstTrade: false, wasIdempotentReplay: true };
    }
    throw err;
  }
}

class TradeError extends Error {
  constructor(public readonly code: ExecuteTradeError) {
    super(code);
  }
}
class IdempotencyHit extends Error {
  constructor() {
    super("idempotency_hit");
  }
}

async function countUserTrades(db: Db, userId: string): Promise<number> {
  const rows = await db
    .select({ id: trades.id })
    .from(trades)
    .where(eq(trades.userId, userId))
    .limit(2);
  return rows.length;
}

export type ListTradesInput = {
  userId: string;
  limit: number;
};

export async function listTrades(db: Db, input: ListTradesInput): Promise<Trade[]> {
  const limit = Math.min(Math.max(input.limit, 1), 200);
  return db
    .select()
    .from(trades)
    .where(eq(trades.userId, input.userId))
    .orderBy(desc(trades.createdAt))
    .limit(limit);
}

export const ASSET_IDS = ASSETS.map((a) => a.id);
