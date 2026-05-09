import type { Db } from "@/db/client.js";
import { type HoldingsJson, portfolios } from "@/db/schema/index.js";
import { ASSETS, type AssetId } from "@paper/shared";
import { Decimal } from "decimal.js";
import { eq } from "drizzle-orm";
import { getAllCachedPrices } from "./prices.js";

export const STARTING_CASH_USD = "10000.00000000";

export type AssetValuation = {
  asset_id: AssetId;
  qty: string;
  cost_basis: string;
  price_usd: number | null;
  value_usd: string | null;
};

export type PortfolioWithValuation = {
  user_id: string;
  cash_usd: string;
  holdings: AssetValuation[];
  total_value_usd: string;
  created_at: string;
};

/** Idempotent: returns the existing portfolio if one exists, otherwise creates with $10k cash + empty holdings. */
export async function initializePortfolio(db: Db, userId: string): Promise<{ created: boolean }> {
  const inserted = await db
    .insert(portfolios)
    .values({ userId, cashUsd: STARTING_CASH_USD, holdings: {} })
    .onConflictDoNothing({ target: portfolios.userId })
    .returning({ userId: portfolios.userId });
  return { created: inserted.length === 1 };
}

export async function getPortfolioWithValuation(
  db: Db,
  redisUrl: string,
  userId: string,
): Promise<PortfolioWithValuation | null> {
  const [row] = await db.select().from(portfolios).where(eq(portfolios.userId, userId));
  if (!row) return null;

  const prices = await getAllCachedPrices(redisUrl);
  const holdings: AssetValuation[] = ASSETS.flatMap((a) => {
    const h = (row.holdings as HoldingsJson)[a.id];
    if (!h) return [];
    const price = prices[a.id];
    const qtyDec = new Decimal(h.qty);
    const priceDec = price ? new Decimal(price.usd) : null;
    const valueDec = priceDec ? qtyDec.mul(priceDec) : null;
    return [
      {
        asset_id: a.id,
        qty: h.qty,
        cost_basis: h.cost_basis,
        price_usd: price?.usd ?? null,
        value_usd: valueDec ? valueDec.toFixed(8) : null,
      },
    ];
  });

  const cashDec = new Decimal(row.cashUsd);
  const holdingsValueDec = holdings.reduce(
    (acc, h) => (h.value_usd ? acc.plus(new Decimal(h.value_usd)) : acc),
    new Decimal(0),
  );
  const totalDec = cashDec.plus(holdingsValueDec);

  return {
    user_id: row.userId,
    cash_usd: row.cashUsd,
    holdings,
    total_value_usd: totalDec.toFixed(8),
    created_at: row.createdAt.toISOString(),
  };
}
