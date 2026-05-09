import {
  PRICE_CACHE_TTL_SECONDS,
  fetchAndCacheAllPrices,
  getCachedPrice,
} from "@/services/prices.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withFreshRedis } from "../helpers/redis.js";

const url = process.env.REDIS_URL ?? "redis://localhost:6379";

describe("prices service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getCachedPrice returns null on miss", async () => {
    await withFreshRedis(async () => {
      const p = await getCachedPrice(url, "BTC");
      expect(p).toBeNull();
    });
  });

  it("fetchAndCacheAllPrices writes one entry per asset with 24h prev", async () => {
    const mockTicker = (symbol: string, last: string, prev: string) =>
      Promise.resolve(
        new Response(JSON.stringify({ symbol, lastPrice: last, prevClosePrice: prev }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const reqUrl = String(input);
        const symbol = new URL(reqUrl).searchParams.get("symbol") ?? "UNKNOWN";
        // last = symbol-length × 100, prev = last × 0.99 — predictable but not all 1s
        const last = (symbol.length * 100).toFixed(2);
        const prev = (symbol.length * 99).toFixed(2);
        return mockTicker(symbol, last, prev);
      }),
    );

    await withFreshRedis(async (r) => {
      await fetchAndCacheAllPrices(url);
      const keys = (await r.keys("paper:price:*")).sort();
      expect(keys).toHaveLength(12);
      const btc = await getCachedPrice(url, "BTC");
      expect(btc).not.toBeNull();
      expect(btc?.usd).toBeGreaterThan(0);
      expect(btc?.prevUsd).toBeGreaterThan(0);
      expect(btc?.usd).not.toBe(btc?.prevUsd);
      const ttl = await r.ttl("paper:price:BTC");
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(PRICE_CACHE_TTL_SECONDS);
    });
  });

  it("getCachedPrice ignores corrupted entries gracefully", async () => {
    await withFreshRedis(async (r) => {
      await r.set("paper:price:BTC", "not-json", "EX", 60);
      const p = await getCachedPrice(url, "BTC");
      expect(p).toBeNull();
    });
  });
});
