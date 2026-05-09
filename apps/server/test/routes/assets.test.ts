import { closeRedis } from "@/services/redis.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withFreshRedis } from "../helpers/redis.js";
import { type TestServer, makeTestServer } from "../helpers/server.js";

describe("GET /v1/assets", () => {
  let ctx: TestServer;
  beforeAll(async () => {
    ctx = await makeTestServer();
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.sql.end();
    await closeRedis();
  });

  async function authedHeaders(): Promise<Record<string, string>> {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/device",
      payload: { device_uuid: "00000000-0000-0000-0000-00000000a001" },
    });
    const body = res.json() as { access_token: string };
    return { authorization: `Bearer ${body.access_token}` };
  }

  it("returns 401 without a token", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/v1/assets" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 12 assets with null prices when cache is empty", async () => {
    await withFreshRedis(async () => {
      const headers = await authedHeaders();
      const res = await ctx.app.inject({ method: "GET", url: "/v1/assets", headers });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        assets: Array<{
          id: string;
          pastel: string;
          price_usd: number | null;
          cached_at: number | null;
        }>;
      };
      expect(body.assets).toHaveLength(12);
      const ids = body.assets.map((a) => a.id);
      expect(ids).toContain("BTC");
      expect(ids).toContain("USDC");
      const btc = body.assets.find((a) => a.id === "BTC");
      expect(btc?.price_usd).toBeNull();
      expect(btc?.cached_at).toBeNull();
      // Pastel rotation is stable + index-driven; BTC is index 0 → "peach".
      expect(btc?.pastel).toBe("peach");
    });
  });

  it("returns prices when cache is populated", async () => {
    await withFreshRedis(async (r) => {
      await r.set(
        "paper:price:BTC",
        JSON.stringify({ usd: 70000, prevUsd: 69000, ts: 1 }),
        "EX",
        120,
      );
      const headers = await authedHeaders();
      const res = await ctx.app.inject({ method: "GET", url: "/v1/assets", headers });
      const body = res.json() as {
        assets: Array<{
          id: string;
          pastel: string;
          price_usd: number | null;
          change_24h_pct: number | null;
          cached_at: number | null;
        }>;
      };
      const btc = body.assets.find((a) => a.id === "BTC");
      expect(btc?.price_usd).toBe(70000);
      // (70000 - 69000) / 69000 * 100 ≈ 1.4493
      expect(btc?.change_24h_pct).toBeCloseTo(1.4493, 3);
      expect(btc?.cached_at).toBe(1);
      expect(btc?.pastel).toBe("peach");
    });
  });
});
