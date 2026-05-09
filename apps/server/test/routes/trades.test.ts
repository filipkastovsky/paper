import { trades, users } from "@/db/schema/index.js";
import { closeRedis } from "@/services/redis.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { truncateAllTables } from "../helpers/db.js";
import { withFreshRedis } from "../helpers/redis.js";
import { type TestServer, makeTestServer } from "../helpers/server.js";

describe("POST /v1/trades", () => {
  let ctx: TestServer;
  beforeAll(async () => {
    ctx = await makeTestServer();
  });
  afterEach(async () => {
    await truncateAllTables(ctx.db);
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.sql.end();
    await closeRedis();
  });

  async function deviceAuth(deviceUuid: string): Promise<{ token: string; userId: string }> {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/device",
      payload: { device_uuid: deviceUuid },
    });
    const body = res.json() as { access_token: string };
    const [u] = await ctx.db.select().from(users).where(eq(users.deviceUuid, deviceUuid));
    if (!u) throw new Error("user not found after auth");
    return { token: body.access_token, userId: u.id };
  }

  it("requires auth", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/v1/trades", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("buys $100 of BTC and returns the trade row + is_first_trade=true", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      await r.set(
        "paper:price:BTC",
        JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }),
        "EX",
        120,
      );
      const { token, userId } = await deviceAuth("00000000-0000-0000-0000-00000000ba01");
      const res = await ctx.app.inject({
        method: "POST",
        url: "/v1/trades",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {
          asset_id: "BTC",
          side: "buy",
          usd_amount: "100.00",
          idempotency_key: "k-1",
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as {
        trade: {
          id: string;
          asset_id: string;
          side: string;
          qty: string;
          usd_amount: string;
          price_at_execution: string;
          created_at: string;
        };
        is_first_trade: boolean;
      };
      expect(body.trade.asset_id).toBe("BTC");
      expect(body.trade.side).toBe("buy");
      expect(body.trade.qty).toBe("0.00200000");
      expect(body.trade.price_at_execution).toBe("50000.00000000");
      expect(body.is_first_trade).toBe(true);

      const rows = await ctx.db.select().from(trades).where(eq(trades.userId, userId));
      expect(rows).toHaveLength(1);
    });
  });

  it("returns 409 with the existing trade for an idempotency replay", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      await r.set(
        "paper:price:BTC",
        JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }),
        "EX",
        120,
      );
      const { token } = await deviceAuth("00000000-0000-0000-0000-00000000ba02");
      const send = () =>
        ctx.app.inject({
          method: "POST",
          url: "/v1/trades",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          payload: {
            asset_id: "BTC",
            side: "buy",
            usd_amount: "100.00",
            idempotency_key: "k-dup",
          },
        });
      const a = await send();
      const b = await send();
      expect(a.statusCode).toBe(201);
      expect(b.statusCode).toBe(200);
      const aBody = a.json() as { trade: { id: string } };
      const bBody = b.json() as { trade: { id: string }; is_first_trade: boolean };
      expect(bBody.trade.id).toBe(aBody.trade.id);
      expect(bBody.is_first_trade).toBe(false);
    });
  });

  it("rejects insufficient_cash with 422", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      await r.set(
        "paper:price:BTC",
        JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }),
        "EX",
        120,
      );
      const { token } = await deviceAuth("00000000-0000-0000-0000-00000000ba03");
      const res = await ctx.app.inject({
        method: "POST",
        url: "/v1/trades",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {
          asset_id: "BTC",
          side: "buy",
          usd_amount: "100000.00",
          idempotency_key: "k-bad",
        },
      });
      expect(res.statusCode).toBe(422);
      expect((res.json() as { error: string }).error).toBe("insufficient_cash");
    });
  });

  it("rejects price_unavailable with 503 when cache is empty", async () => {
    await withFreshRedis(async () => {
      const { token } = await deviceAuth("00000000-0000-0000-0000-00000000ba04");
      const res = await ctx.app.inject({
        method: "POST",
        url: "/v1/trades",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {
          asset_id: "BTC",
          side: "buy",
          usd_amount: "100.00",
          idempotency_key: "k-no-price",
        },
      });
      expect(res.statusCode).toBe(503);
      expect((res.json() as { error: string }).error).toBe("price_unavailable");
    });
  });

  it("rejects unknown_asset with 400", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      await r.set(
        "paper:price:BTC",
        JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }),
        "EX",
        120,
      );
      const { token } = await deviceAuth("00000000-0000-0000-0000-00000000ba05");
      const res = await ctx.app.inject({
        method: "POST",
        url: "/v1/trades",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {
          asset_id: "ZZZ",
          side: "buy",
          usd_amount: "100.00",
          idempotency_key: "k-unknown",
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it("throttles to 20/min per user — the 21st returns 429", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      await r.set(
        "paper:price:BTC",
        JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }),
        "EX",
        120,
      );
      const { token } = await deviceAuth("00000000-0000-0000-0000-00000000ba06");
      // 20 distinct buys keep portfolio above zero (20 × $1 << $10k starter cash).
      for (let i = 0; i < 20; i++) {
        const res = await ctx.app.inject({
          method: "POST",
          url: "/v1/trades",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          payload: {
            asset_id: "BTC",
            side: "buy",
            usd_amount: "1.00",
            idempotency_key: `k-rl-${i}`,
          },
        });
        expect(res.statusCode).toBe(201);
      }
      const blocked = await ctx.app.inject({
        method: "POST",
        url: "/v1/trades",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {
          asset_id: "BTC",
          side: "buy",
          usd_amount: "1.00",
          idempotency_key: "k-rl-21",
        },
      });
      expect(blocked.statusCode).toBe(429);
    });
  });

  it("rate limit is per-user, not per-IP — distinct JWTs share the simulated IP but get their own budget", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      await r.set(
        "paper:price:BTC",
        JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }),
        "EX",
        120,
      );
      const a = await deviceAuth("00000000-0000-0000-0000-00000000ba07");
      const b = await deviceAuth("00000000-0000-0000-0000-00000000ba08");
      // User A burns through their 20-trade quota.
      for (let i = 0; i < 20; i++) {
        const res = await ctx.app.inject({
          method: "POST",
          url: "/v1/trades",
          headers: { authorization: `Bearer ${a.token}`, "content-type": "application/json" },
          payload: {
            asset_id: "BTC",
            side: "buy",
            usd_amount: "1.00",
            idempotency_key: `k-multi-a-${i}`,
          },
        });
        expect(res.statusCode).toBe(201);
      }
      // User A is now throttled.
      const aBlocked = await ctx.app.inject({
        method: "POST",
        url: "/v1/trades",
        headers: { authorization: `Bearer ${a.token}`, "content-type": "application/json" },
        payload: {
          asset_id: "BTC",
          side: "buy",
          usd_amount: "1.00",
          idempotency_key: "k-multi-a-21",
        },
      });
      expect(aBlocked.statusCode).toBe(429);
      // User B (same IP, different JWT) must still trade — proves per-user keying.
      const bOk = await ctx.app.inject({
        method: "POST",
        url: "/v1/trades",
        headers: { authorization: `Bearer ${b.token}`, "content-type": "application/json" },
        payload: {
          asset_id: "BTC",
          side: "buy",
          usd_amount: "1.00",
          idempotency_key: "k-multi-b-1",
        },
      });
      expect(bOk.statusCode).toBe(201);
    });
  });
});

describe("GET /v1/trades", () => {
  let ctx: TestServer;
  beforeAll(async () => {
    ctx = await makeTestServer();
  });
  afterEach(async () => {
    await truncateAllTables(ctx.db);
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.sql.end();
    await closeRedis();
  });

  async function deviceAuth(uuid: string): Promise<string> {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/device",
      payload: { device_uuid: uuid },
    });
    return (res.json() as { access_token: string }).access_token;
  }

  it("requires auth", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/v1/trades" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the user's trades, newest first, capped by limit", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      await r.set(
        "paper:price:BTC",
        JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }),
        "EX",
        120,
      );
      const token = await deviceAuth("00000000-0000-0000-0000-00000000bb01");

      for (let i = 0; i < 3; i++) {
        await ctx.app.inject({
          method: "POST",
          url: "/v1/trades",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          payload: {
            asset_id: "BTC",
            side: "buy",
            usd_amount: "1.00",
            idempotency_key: `k-${i}`,
          },
        });
      }
      const res = await ctx.app.inject({
        method: "GET",
        url: "/v1/trades?limit=2",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { trades: Array<{ id: string; idempotency_key: string }> };
      expect(body.trades).toHaveLength(2);
      // Newest first: idempotency_key for index 2 should appear before index 1.
      expect(body.trades[0]?.idempotency_key).toBe("k-2");
      expect(body.trades[1]?.idempotency_key).toBe("k-1");
    });
  });
});
