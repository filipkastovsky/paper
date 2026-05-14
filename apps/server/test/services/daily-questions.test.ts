import { loadConfig } from "@/config.js";
import { makeDb } from "@/db/client.js";
import { dailyQuestions } from "@/db/schema/index.js";
import {
  getOrCreateTodayQuestion,
  getTodayQuestion,
  resolveYesterdayQuestion,
  todayUtcDate,
} from "@/services/daily-questions.js";
import { closeRedis } from "@/services/redis.js";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { truncateAllTables } from "../helpers/db.js";
import { withFreshRedis } from "../helpers/redis.js";

describe("daily-questions service", () => {
  const config = loadConfig({
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/paper",
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
    // Dummy VAPID keys — example values, safe for tests only, NOT for production
    VAPID_PUBLIC_KEY:
      "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
    VAPID_PRIVATE_KEY: "UUxI4O8-HoSvQnHBrfWEPljd0-m7QkGCHJaFqHQBTMs",
    JWT_SECRET: "test-secret-must-be-at-least-32-characters-long",
    LOG_LEVEL: "fatal",
  });
  const handles = makeDb(config.DATABASE_URL, { max: 2 });
  const db = handles.db;

  afterEach(async () => {
    await truncateAllTables(db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  it("todayUtcDate returns a YYYY-MM-DD string", () => {
    const d = todayUtcDate();
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("getOrCreateTodayQuestion creates a row when none exists", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      const assetIds = [
        "BTC",
        "ETH",
        "SOL",
        "BNB",
        "XRP",
        "ADA",
        "DOGE",
        "AVAX",
        "LINK",
        "DOT",
        "TON",
      ] as const;
      for (const id of assetIds) {
        await r.set(
          `paper:price:${id}`,
          JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }),
          "EX",
          120,
        );
      }
      const q = await getOrCreateTodayQuestion(db, config.REDIS_URL);
      expect(q.date).toBe(todayUtcDate());
      expect(q.directionResolved).toBeNull();
      expect(Number(q.baselinePriceUsd)).toBeGreaterThan(0);
    });
  });

  it("getOrCreateTodayQuestion is idempotent — second call returns same row", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      const assetIds = [
        "BTC",
        "ETH",
        "SOL",
        "BNB",
        "XRP",
        "ADA",
        "DOGE",
        "AVAX",
        "LINK",
        "DOT",
        "TON",
      ] as const;
      for (const id of assetIds) {
        await r.set(`paper:price:${id}`, JSON.stringify({ usd: 1, prevUsd: 1, ts }), "EX", 120);
      }
      const a = await getOrCreateTodayQuestion(db, config.REDIS_URL);
      const b = await getOrCreateTodayQuestion(db, config.REDIS_URL);
      expect(a.id).toBe(b.id);
    });
  });

  it("getTodayQuestion returns null when no row exists", async () => {
    const result = await getTodayQuestion(db);
    expect(result).toBeNull();
  });

  it("getTodayQuestion returns the row after creation", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      const assetIds = [
        "BTC",
        "ETH",
        "SOL",
        "BNB",
        "XRP",
        "ADA",
        "DOGE",
        "AVAX",
        "LINK",
        "DOT",
        "TON",
      ] as const;
      for (const id of assetIds) {
        await r.set(`paper:price:${id}`, JSON.stringify({ usd: 100, prevUsd: 99, ts }), "EX", 120);
      }
      const created = await getOrCreateTodayQuestion(db, config.REDIS_URL);
      const fetched = await getTodayQuestion(db);
      expect(fetched?.id).toBe(created.id);
    });
  });

  it("resolveYesterdayQuestion returns null when no yesterday row exists", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      await r.set(
        "paper:price:BTC",
        JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }),
        "EX",
        120,
      );
      const result = await resolveYesterdayQuestion(db, config.REDIS_URL);
      expect(result).toBeNull();
    });
  });

  it("resolveYesterdayQuestion resolves an existing unresolved yesterday row", async () => {
    await withFreshRedis(async (r) => {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

      await db.insert(dailyQuestions).values({
        date: yesterdayStr,
        assetId: "BTC",
        baselinePriceUsd: "40000",
      });

      const ts = Math.floor(Date.now() / 1000);
      await r.set(
        "paper:price:BTC",
        JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }),
        "EX",
        120,
      );

      const resolved = await resolveYesterdayQuestion(db, config.REDIS_URL);
      expect(resolved?.directionResolved).toBe("up");
      expect(resolved?.resolvedAt).not.toBeNull();
    });
  });

  it("resolveYesterdayQuestion resolves as 'down' when current price < baseline", async () => {
    await withFreshRedis(async (r) => {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

      await db.insert(dailyQuestions).values({
        date: yesterdayStr,
        assetId: "ETH",
        baselinePriceUsd: "3000",
      });

      const ts = Math.floor(Date.now() / 1000);
      await r.set("paper:price:ETH", JSON.stringify({ usd: 2000, prevUsd: 2800, ts }), "EX", 120);

      const resolved = await resolveYesterdayQuestion(db, config.REDIS_URL);
      expect(resolved?.directionResolved).toBe("down");
    });
  });

  it("resolveYesterdayQuestion is idempotent — already-resolved row is returned as-is", async () => {
    await withFreshRedis(async (r) => {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

      const [inserted] = await db
        .insert(dailyQuestions)
        .values({
          date: yesterdayStr,
          assetId: "BTC",
          baselinePriceUsd: "40000",
          directionResolved: "up",
          resolvedAt: new Date(),
        })
        .returning();

      const result = await resolveYesterdayQuestion(db, config.REDIS_URL);
      expect(result?.id).toBe(inserted?.id);
      expect(result?.directionResolved).toBe("up");
    });
  });
});
