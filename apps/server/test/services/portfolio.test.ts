import { makeDb } from "@/db/client.js";
import { portfolios, users } from "@/db/schema/index.js";
import {
  STARTING_CASH_USD,
  getPortfolioWithValuation,
  initializePortfolio,
} from "@/services/portfolio.js";
import { closeRedis } from "@/services/redis.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { truncateAllTables } from "../helpers/db.js";
import { withFreshRedis } from "../helpers/redis.js";

const dbUrl = process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/paper";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

describe("initializePortfolio", () => {
  const handles = makeDb(dbUrl, { max: 2 });

  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  async function makeUser(deviceUuid = "00000000-0000-0000-0000-000000000aaa"): Promise<string> {
    const [u] = await handles.db.insert(users).values({ deviceUuid }).returning({ id: users.id });
    if (!u) throw new Error("no user inserted");
    return u.id;
  }

  it("creates a portfolio with $10k cash and empty holdings", async () => {
    const userId = await makeUser();
    const { created } = await initializePortfolio(handles.db, userId);
    expect(created).toBe(true);
    const [row] = await handles.db.select().from(portfolios).where(eq(portfolios.userId, userId));
    expect(row?.cashUsd).toBe(STARTING_CASH_USD);
    expect(row?.holdings).toEqual({});
  });

  it("is idempotent — second call reports created=false", async () => {
    const userId = await makeUser();
    const first = await initializePortfolio(handles.db, userId);
    const second = await initializePortfolio(handles.db, userId);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
  });
});

describe("getPortfolioWithValuation", () => {
  const handles = makeDb(dbUrl, { max: 2 });

  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  it("returns null when no portfolio exists", async () => {
    const p = await getPortfolioWithValuation(
      handles.db,
      redisUrl,
      "00000000-0000-0000-0000-deadbeef0001",
    );
    expect(p).toBeNull();
  });

  it("returns cash-only portfolio with total = cash when holdings empty", async () => {
    await withFreshRedis(async () => {
      const [u] = await handles.db
        .insert(users)
        .values({ deviceUuid: "00000000-0000-0000-0000-000000000bbb" })
        .returning({ id: users.id });
      if (!u) throw new Error("no user");
      await initializePortfolio(handles.db, u.id);
      const p = await getPortfolioWithValuation(handles.db, redisUrl, u.id);
      expect(p).not.toBeNull();
      expect(p?.cash_usd).toBe(STARTING_CASH_USD);
      expect(p?.holdings).toEqual([]);
      expect(p?.total_value_usd).toBe(STARTING_CASH_USD);
    });
  });

  it("computes value_usd and total_value_usd from cash + qty × price (Decimal-exact)", async () => {
    await withFreshRedis(async (r) => {
      const [u] = await handles.db
        .insert(users)
        .values({ deviceUuid: "00000000-0000-0000-0000-000000000ccc" })
        .returning({ id: users.id });
      if (!u) throw new Error("no user");

      // Seed a portfolio with 0.5 BTC + 100 SOL, cash 1000.50000000.
      await handles.db.insert(portfolios).values({
        userId: u.id,
        cashUsd: "1000.50000000",
        holdings: {
          BTC: { qty: "0.50000000", cost_basis: "30000.00000000" },
          SOL: { qty: "100.00000000", cost_basis: "20.00000000" },
        },
      });

      // Seed Redis prices: BTC $70,000.12345678, SOL $200.00000000.
      // Note: ts is bumped to a non-zero value so getCachedPrice's shape
      // validator doesn't filter the entry.
      const ts = Math.floor(Date.now() / 1000);
      await r.set(
        "paper:price:BTC",
        JSON.stringify({ usd: 70000.12345678, prevUsd: 69000, ts }),
        "EX",
        120,
      );
      await r.set("paper:price:SOL", JSON.stringify({ usd: 200, prevUsd: 195, ts }), "EX", 120);

      const p = await getPortfolioWithValuation(handles.db, redisUrl, u.id);
      expect(p).not.toBeNull();

      // Holdings come back in canonical ASSETS order: BTC (idx 0), SOL (idx 2).
      expect(p?.holdings.map((h) => h.asset_id)).toEqual(["BTC", "SOL"]);

      // 0.5 × 70_000.12345678 = 35_000.06172839
      const btc = p?.holdings.find((h) => h.asset_id === "BTC");
      expect(btc?.value_usd).toBe("35000.06172839");
      expect(btc?.price_usd).toBe(70000.12345678);

      // 100 × 200 = 20_000
      const sol = p?.holdings.find((h) => h.asset_id === "SOL");
      expect(sol?.value_usd).toBe("20000.00000000");

      // Total: 1000.5 cash + 35000.06172839 BTC + 20000 SOL = 56000.56172839
      expect(p?.total_value_usd).toBe("56000.56172839");
    });
  });

  it("leaves value_usd null for holdings with no cached price", async () => {
    await withFreshRedis(async () => {
      const [u] = await handles.db
        .insert(users)
        .values({ deviceUuid: "00000000-0000-0000-0000-000000000ddd" })
        .returning({ id: users.id });
      if (!u) throw new Error("no user");

      await handles.db.insert(portfolios).values({
        userId: u.id,
        cashUsd: "5000.00000000",
        holdings: { BTC: { qty: "1.00000000", cost_basis: "30000.00000000" } },
      });

      // No Redis prices seeded.
      const p = await getPortfolioWithValuation(handles.db, redisUrl, u.id);
      const btc = p?.holdings.find((h) => h.asset_id === "BTC");
      expect(btc?.price_usd).toBeNull();
      expect(btc?.value_usd).toBeNull();
      // total_value_usd skips uncomputable holdings — falls back to cash only.
      expect(p?.total_value_usd).toBe("5000.00000000");
    });
  });
});
