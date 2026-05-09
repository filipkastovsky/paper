import { makeDb } from "@/db/client.js";
import { portfolioSnapshots, portfolios, trades, users } from "@/db/schema/index.js";
import { closeRedis } from "@/services/redis.js";
import { executeTrade, listTrades } from "@/services/trades.js";
import { Decimal } from "decimal.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { truncateAllTables } from "../helpers/db.js";
import { withFreshRedis } from "../helpers/redis.js";

const dbUrl = process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/paper";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

async function seedUser(
  db: ReturnType<typeof makeDb>["db"],
  uuid = "00000000-0000-0000-0000-00000000aaa1",
): Promise<string> {
  const [u] = await db.insert(users).values({ deviceUuid: uuid }).returning({ id: users.id });
  if (!u) throw new Error("no user inserted");
  await db.insert(portfolios).values({
    userId: u.id,
    cashUsd: "10000.00000000",
    holdings: {},
  });
  return u.id;
}

async function seedPriceBTC(
  r: import("ioredis").Redis,
  usd = 50_000,
  prevUsd = 49_000,
): Promise<void> {
  const ts = Math.floor(Date.now() / 1000);
  await r.set("paper:price:BTC", JSON.stringify({ usd, prevUsd, ts }), "EX", 120);
}

describe("executeTrade — buy path", () => {
  const handles = makeDb(dbUrl, { max: 2 });
  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  it("buys $1,000 of BTC at $50k → 0.02 BTC, cash 9000, one Trade row", async () => {
    await withFreshRedis(async (r) => {
      const userId = await seedUser(handles.db);
      await seedPriceBTC(r);

      const result = await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "buy",
        usdAmount: "1000.00000000",
        idempotencyKey: "k-buy-1",
      });

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.trade.qty).toBe("0.02000000");
      expect(result.trade.priceAtExecution).toBe("50000.00000000");
      expect(result.trade.usdAmount).toBe("1000.00000000");
      expect(result.trade.side).toBe("buy");
      expect(result.isFirstTrade).toBe(true);

      const [p] = await handles.db.select().from(portfolios).where(eq(portfolios.userId, userId));
      expect(p?.cashUsd).toBe("9000.00000000");
      expect(p?.holdings).toEqual({
        BTC: { qty: "0.02000000", cost_basis: "50000.00000000" },
      });

      const allTrades = await handles.db.select().from(trades).where(eq(trades.userId, userId));
      expect(allTrades).toHaveLength(1);
    });
  });

  it("buys add to existing holding and recompute cost_basis as weighted average", async () => {
    await withFreshRedis(async (r) => {
      const userId = await seedUser(handles.db);
      await seedPriceBTC(r, 50_000);

      await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "buy",
        usdAmount: "1000.00000000",
        idempotencyKey: "k1",
      });
      await seedPriceBTC(r, 100_000);
      await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "buy",
        usdAmount: "1000.00000000",
        idempotencyKey: "k2",
      });

      const [p] = await handles.db.select().from(portfolios).where(eq(portfolios.userId, userId));
      // 0.02 BTC at 50k + 0.01 BTC at 100k = 0.03 BTC at avg cost ≈ 66,666.67
      expect(p?.holdings).toEqual({
        BTC: { qty: "0.03000000", cost_basis: "66666.66666667" },
      });
      expect(p?.cashUsd).toBe("8000.00000000");
    });
  });

  it("rejects insufficient_cash without writing", async () => {
    await withFreshRedis(async (r) => {
      const userId = await seedUser(handles.db);
      await seedPriceBTC(r);

      const result = await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "buy",
        usdAmount: "100000.00000000",
        idempotencyKey: "k-bad",
      });
      expect(result.kind).toBe("error");
      if (result.kind !== "error") return;
      expect(result.code).toBe("insufficient_cash");

      const [p] = await handles.db.select().from(portfolios).where(eq(portfolios.userId, userId));
      expect(p?.cashUsd).toBe("10000.00000000");
      const all = await handles.db.select().from(trades).where(eq(trades.userId, userId));
      expect(all).toHaveLength(0);
    });
  });
});

describe("executeTrade — sell path", () => {
  const handles = makeDb(dbUrl, { max: 2 });
  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  it("sells partial qty, deducts holding qty, cost_basis stays the same", async () => {
    await withFreshRedis(async (r) => {
      const userId = await seedUser(handles.db);
      await seedPriceBTC(r, 50_000);

      // Set up a position: 0.10 BTC at avg 40k.
      await handles.db
        .update(portfolios)
        .set({
          cashUsd: "1000.00000000",
          holdings: { BTC: { qty: "0.10000000", cost_basis: "40000.00000000" } },
        })
        .where(eq(portfolios.userId, userId));

      const result = await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "sell",
        usdAmount: "500.00000000",
        idempotencyKey: "k-sell-1",
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      // 500 / 50_000 = 0.01 BTC sold
      expect(result.trade.qty).toBe("0.01000000");

      const [p] = await handles.db.select().from(portfolios).where(eq(portfolios.userId, userId));
      expect(p?.cashUsd).toBe("1500.00000000");
      expect(p?.holdings).toEqual({
        BTC: { qty: "0.09000000", cost_basis: "40000.00000000" },
      });
    });
  });

  it("removes the holding entry when qty hits zero", async () => {
    await withFreshRedis(async (r) => {
      const userId = await seedUser(handles.db);
      await seedPriceBTC(r, 50_000);

      await handles.db
        .update(portfolios)
        .set({
          cashUsd: "0.00000000",
          holdings: { BTC: { qty: "0.02000000", cost_basis: "50000.00000000" } },
        })
        .where(eq(portfolios.userId, userId));

      const result = await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "sell",
        usdAmount: "1000.00000000",
        idempotencyKey: "k-sell-all",
      });
      expect(result.kind).toBe("ok");

      const [p] = await handles.db.select().from(portfolios).where(eq(portfolios.userId, userId));
      expect(p?.cashUsd).toBe("1000.00000000");
      expect(p?.holdings).toEqual({});
    });
  });

  it("rejects insufficient_qty without writing", async () => {
    await withFreshRedis(async (r) => {
      const userId = await seedUser(handles.db);
      await seedPriceBTC(r, 50_000);

      // 0.001 BTC = $50 of value; selling $1000 worth must fail.
      await handles.db
        .update(portfolios)
        .set({
          holdings: { BTC: { qty: "0.00100000", cost_basis: "50000.00000000" } },
        })
        .where(eq(portfolios.userId, userId));

      const result = await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "sell",
        usdAmount: "1000.00000000",
        idempotencyKey: "k-sell-bad",
      });
      expect(result.kind).toBe("error");
      if (result.kind !== "error") return;
      expect(result.code).toBe("insufficient_qty");

      const all = await handles.db.select().from(trades).where(eq(trades.userId, userId));
      expect(all).toHaveLength(0);
    });
  });
});

describe("executeTrade — error mapping", () => {
  const handles = makeDb(dbUrl, { max: 2 });
  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  it("returns price_unavailable when the cache has no entry", async () => {
    await withFreshRedis(async () => {
      const userId = await seedUser(handles.db);
      const result = await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "buy",
        usdAmount: "100.00000000",
        idempotencyKey: "k-no-price",
      });
      expect(result.kind).toBe("error");
      if (result.kind !== "error") return;
      expect(result.code).toBe("price_unavailable");
    });
  });

  it("returns unknown_asset for an asset not in ASSETS", async () => {
    await withFreshRedis(async (r) => {
      const userId = await seedUser(handles.db);
      await seedPriceBTC(r, 50_000);
      const result = await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "ZZZ",
        side: "buy",
        usdAmount: "100.00000000",
        idempotencyKey: "k-unknown",
      });
      expect(result.kind).toBe("error");
      if (result.kind !== "error") return;
      expect(result.code).toBe("unknown_asset");
    });
  });
});

describe("executeTrade — idempotency", () => {
  const handles = makeDb(dbUrl, { max: 2 });
  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  it("a second call with the same key returns the same Trade and does not double-spend", async () => {
    await withFreshRedis(async (r) => {
      const userId = await seedUser(handles.db);
      await seedPriceBTC(r, 50_000);

      const a = await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "buy",
        usdAmount: "1000.00000000",
        idempotencyKey: "k-dup",
      });
      // Bump price so we can detect that the second call did NOT execute fresh.
      await seedPriceBTC(r, 100_000);
      const b = await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "buy",
        usdAmount: "1000.00000000",
        idempotencyKey: "k-dup",
      });

      expect(a.kind).toBe("ok");
      expect(b.kind).toBe("ok");
      if (a.kind !== "ok" || b.kind !== "ok") return;
      expect(a.trade.id).toBe(b.trade.id);
      expect(a.trade.priceAtExecution).toBe("50000.00000000");
      expect(b.trade.priceAtExecution).toBe("50000.00000000");
      expect(b.isFirstTrade).toBe(false);

      const all = await handles.db.select().from(trades).where(eq(trades.userId, userId));
      expect(all).toHaveLength(1);

      const [p] = await handles.db.select().from(portfolios).where(eq(portfolios.userId, userId));
      // Cash dropped once (10000 → 9000), not twice.
      expect(p?.cashUsd).toBe("9000.00000000");
    });
  });
});

describe("listTrades", () => {
  const handles = makeDb(dbUrl, { max: 2 });
  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  it("returns most-recent-first with limit", async () => {
    await withFreshRedis(async (r) => {
      const userId = await seedUser(handles.db);
      await seedPriceBTC(r, 50_000);
      for (let i = 0; i < 3; i++) {
        await executeTrade(handles.db, redisUrl, {
          userId,
          assetId: "BTC",
          side: "buy",
          usdAmount: "100.00000000",
          idempotencyKey: `k-${i}`,
        });
      }
      const list = await listTrades(handles.db, { userId, limit: 2 });
      expect(list).toHaveLength(2);
      // biome-ignore lint/style/noNonNullAssertion: list.length === 2 asserted above
      expect(new Date(list[0]!.createdAt).getTime()).toBeGreaterThanOrEqual(
        // biome-ignore lint/style/noNonNullAssertion: list.length === 2 asserted above
        new Date(list[1]!.createdAt).getTime(),
      );
    });
  });

  it("scopes by user", async () => {
    await withFreshRedis(async (r) => {
      const u1 = await seedUser(handles.db, "00000000-0000-0000-0000-00000000aaa1");
      const u2 = await seedUser(handles.db, "00000000-0000-0000-0000-00000000aaa2");
      await seedPriceBTC(r, 50_000);
      await executeTrade(handles.db, redisUrl, {
        userId: u1,
        assetId: "BTC",
        side: "buy",
        usdAmount: "100.00000000",
        idempotencyKey: "k-u1",
      });
      const list = await listTrades(handles.db, { userId: u2, limit: 50 });
      expect(list).toHaveLength(0);
    });
  });
});

describe("executeTrade — snapshot back-fill", () => {
  const handles = makeDb(dbUrl, { max: 2 });
  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  it("inserts a today snapshot BEFORE the trade, capturing the pre-trade portfolio value", async () => {
    await withFreshRedis(async (r) => {
      const userId = await seedUser(handles.db);
      await seedPriceBTC(r, 50_000);

      const result = await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "buy",
        usdAmount: "1000.00000000",
        idempotencyKey: "k-snapshot-backfill",
      });
      expect(result.kind).toBe("ok");

      const today = new Date().toISOString().slice(0, 10);
      const [snap] = await handles.db
        .select()
        .from(portfolioSnapshots)
        .where(eq(portfolioSnapshots.userId, userId));

      // The snapshot must exist and must reflect the PRE-trade balance ($10k cash, $0 holdings).
      expect(snap).toBeDefined();
      expect(snap?.snapshotDate).toBe(today);
      expect(snap?.totalValueUsd).toBe("10000.00000000");
    });
  });
});

describe("executeTrade — rounding consistency", () => {
  const handles = makeDb(dbUrl, { max: 2 });
  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  // The user requests $100 of BTC at a price that doesn't divide evenly. The
  // server truncates qty to 8dp, then derives the actual transaction value as
  // qty * price. The trade row + cash movement must agree (no leak in either
  // direction). Buy = cash falls by exactly qty * price, not by the requested
  // $100; sell = cash rises by qty * price, never more.
  it("buy at indivisible price leaves trade.usdAmount == qty * priceAtExecution", async () => {
    await withFreshRedis(async (r) => {
      const userId = await seedUser(handles.db);
      // Price chosen so $100 / price has many trailing decimals beyond 8dp.
      const ts = Math.floor(Date.now() / 1000);
      await r.set(
        "paper:price:BTC",
        JSON.stringify({ usd: 70_000.12345678, prevUsd: 69_000, ts }),
        "EX",
        120,
      );

      const result = await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "buy",
        usdAmount: "100.00000000",
        idempotencyKey: "k-precision-buy",
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;

      const usdDec = new Decimal(result.trade.usdAmount);
      // The headline invariant: cash debited == trade.usdAmount, NOT the
      // user-requested $100. (Pre-fix, cash dropped by 100 even though qty
      // could only buy ~$99.999... worth, leaking the rounding scrap.)
      expect(usdDec.lt(new Decimal("100"))).toBe(true);
      const [p] = await handles.db.select().from(portfolios).where(eq(portfolios.userId, userId));
      expect(new Decimal(p?.cashUsd ?? "0").toFixed(8)).toBe(
        new Decimal("10000").minus(usdDec).toFixed(8),
      );
    });
  });

  it("sell at indivisible price credits qty * priceAtExecution, not the request", async () => {
    await withFreshRedis(async (r) => {
      const userId = await seedUser(handles.db);
      const ts = Math.floor(Date.now() / 1000);
      await r.set(
        "paper:price:BTC",
        JSON.stringify({ usd: 70_000.12345678, prevUsd: 69_000, ts }),
        "EX",
        120,
      );
      // Seed plenty of BTC.
      await handles.db
        .update(portfolios)
        .set({
          cashUsd: "0.00000000",
          holdings: { BTC: { qty: "1.00000000", cost_basis: "60000.00000000" } },
        })
        .where(eq(portfolios.userId, userId));

      const result = await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "sell",
        usdAmount: "100.00000000",
        idempotencyKey: "k-precision-sell",
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;

      const usdDec = new Decimal(result.trade.usdAmount);
      // Headline invariant: cash credited equals trade.usdAmount, NOT $100.
      // The user surrendered slightly less than $100 worth of qty.
      expect(usdDec.lt(new Decimal("100"))).toBe(true);
      const [p] = await handles.db.select().from(portfolios).where(eq(portfolios.userId, userId));
      expect(new Decimal(p?.cashUsd ?? "0").toFixed(8)).toBe(usdDec.toFixed(8));
    });
  });
});
