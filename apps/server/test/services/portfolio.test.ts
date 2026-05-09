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
});
