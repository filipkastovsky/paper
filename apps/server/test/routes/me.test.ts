import { portfolioSnapshots, portfolios, users } from "@/db/schema/index.js";
import { closeRedis } from "@/services/redis.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { truncateAllTables } from "../helpers/db.js";
import { withFreshRedis } from "../helpers/redis.js";
import { type TestServer, makeTestServer } from "../helpers/server.js";

describe("GET /v1/me", () => {
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
    if (!u) throw new Error("user not found after deviceAuth");
    return { token: body.access_token, userId: u.id };
  }

  it("requires auth", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/v1/me" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the current user + a $10k portfolio", async () => {
    const { token } = await deviceAuth("00000000-0000-0000-0000-00000000c001");
    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      user: { id: string; handle: string | null; avatar: string | null };
      portfolio: {
        cash_usd: string;
        holdings: unknown[];
        total_value_usd: string;
        today_pct_change: number | null;
      };
    };
    expect(body.user.handle).toBeNull();
    expect(body.user.avatar).toBeNull();
    expect(body.portfolio.cash_usd).toBe("10000.00000000");
    expect(body.portfolio.holdings).toEqual([]);
    expect(body.portfolio.total_value_usd).toBe("10000.00000000");
    expect(body.portfolio.today_pct_change).toBeNull();
  });

  it("returns valued holdings with the documented shape", async () => {
    await withFreshRedis(async (r) => {
      const { token, userId } = await deviceAuth("00000000-0000-0000-0000-00000000c002");
      // Replace the auto-created cash-only portfolio with one holding so the
      // /v1/me boundary actually exercises every Holding field (asset_id, qty,
      // cost_basis, price_usd, value_usd) — the controller-only portfolio
      // service tests cover the math; this guards the route mapping.
      await ctx.db
        .update(portfolios)
        .set({
          cashUsd: "1000.00000000",
          holdings: { BTC: { qty: "0.50000000", cost_basis: "30000.00000000" } },
        })
        .where(eq(portfolios.userId, userId));

      const ts = Math.floor(Date.now() / 1000);
      await r.set("paper:price:BTC", JSON.stringify({ usd: 70000, prevUsd: 69000, ts }), "EX", 120);

      const res = await ctx.app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        portfolio: {
          cash_usd: string;
          total_value_usd: string;
          today_pct_change: number | null;
          holdings: Array<{
            asset_id: string;
            qty: string;
            cost_basis: string;
            price_usd: number | null;
            value_usd: string | null;
          }>;
        };
      };
      expect(body.portfolio.holdings).toHaveLength(1);
      const btc = body.portfolio.holdings[0];
      expect(btc?.asset_id).toBe("BTC");
      expect(btc?.qty).toBe("0.50000000");
      expect(btc?.cost_basis).toBe("30000.00000000");
      expect(btc?.price_usd).toBe(70000);
      // 0.5 × 70_000 = 35_000.00000000
      expect(btc?.value_usd).toBe("35000.00000000");
      // 1000 cash + 35000 BTC = 36000
      expect(body.portfolio.total_value_usd).toBe("36000.00000000");
    });
  });

  it("computes today_pct_change against today's snapshot", async () => {
    await withFreshRedis(async (r) => {
      const { token, userId } = await deviceAuth("00000000-0000-0000-0000-00000000c003");
      // Pre-seed an "open" snapshot at 9,000 so a 10,000 portfolio is +11.11%.
      const today = new Date().toISOString().slice(0, 10);
      await ctx.db.insert(portfolioSnapshots).values({
        userId,
        snapshotDate: today,
        totalValueUsd: "9000.00000000",
      });
      const ts = Math.floor(Date.now() / 1000);
      await r.set("paper:price:BTC", JSON.stringify({ usd: 70000, prevUsd: 69000, ts }), "EX", 120);

      const res = await ctx.app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        portfolio: { today_pct_change: number | null };
      };
      expect(body.portfolio.today_pct_change).toBeCloseTo(11.1111, 4);
    });
  });

  it("GET /v1/me returns streak: null when user has no qualifying actions", async () => {
    const { token } = await deviceAuth("00000000-0000-0000-0000-000000000e01");
    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { streak: null | object };
    expect(body.streak).toBeNull();
  });

  it("GET /v1/me returns streak.current_days after a qualifying trade", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      await r.set(
        "paper:price:BTC",
        JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }),
        "EX",
        120,
      );
      const { token } = await deviceAuth("00000000-0000-0000-0000-000000000e02");
      // Execute a trade to trigger streak upsert
      await ctx.app.inject({
        method: "POST",
        url: "/v1/trades",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {
          asset_id: "BTC",
          side: "buy",
          usd_amount: "10.00",
          idempotency_key: "k-streak-1",
        },
      });
      // Brief pause to let fire-and-forget streak upsert settle
      await new Promise((r) => setTimeout(r, 50));
      const res = await ctx.app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { streak: { current_days: number; longest_days: number } | null };
      expect(body.streak).not.toBeNull();
      expect(body.streak?.current_days).toBe(1);
      expect(body.streak?.longest_days).toBe(1);
    });
  });
});

describe("PATCH /v1/me", () => {
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

  it("sets handle + avatar", async () => {
    await withFreshRedis(async () => {
      const token = await deviceAuth("00000000-0000-0000-0000-00000000d001");
      const res = await ctx.app.inject({
        method: "PATCH",
        url: "/v1/me",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { handle: "alice", avatar: "peach" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { user: { handle: string; avatar: string } };
      expect(body.user.handle).toBe("alice");
      expect(body.user.avatar).toBe("peach");
    });
  });

  it("normalises and rejects bad formats", async () => {
    await withFreshRedis(async () => {
      const token = await deviceAuth("00000000-0000-0000-0000-00000000d002");
      const res = await ctx.app.inject({
        method: "PATCH",
        url: "/v1/me",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { handle: "BAD HANDLE" },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toBe("invalid_handle_format");
    });
  });

  it("rejects reserved handles", async () => {
    await withFreshRedis(async () => {
      const token = await deviceAuth("00000000-0000-0000-0000-00000000d003");
      const res = await ctx.app.inject({
        method: "PATCH",
        url: "/v1/me",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { handle: "admin" },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toBe("handle_reserved");
    });
  });

  it("rejects taken handles with 409", async () => {
    await withFreshRedis(async () => {
      const t1 = await deviceAuth("00000000-0000-0000-0000-00000000d004");
      const t2 = await deviceAuth("00000000-0000-0000-0000-00000000d005");
      const r1 = await ctx.app.inject({
        method: "PATCH",
        url: "/v1/me",
        headers: { authorization: `Bearer ${t1}`, "content-type": "application/json" },
        payload: { handle: "bob" },
      });
      expect(r1.statusCode).toBe(200);
      const r2 = await ctx.app.inject({
        method: "PATCH",
        url: "/v1/me",
        headers: { authorization: `Bearer ${t2}`, "content-type": "application/json" },
        payload: { handle: "bob" },
      });
      expect(r2.statusCode).toBe(409);
      expect((r2.json() as { error: string }).error).toBe("handle_taken");
    });
  });
});

describe("GET /v1/handles/check", () => {
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

  it("returns available=true for an unused valid handle", async () => {
    await withFreshRedis(async () => {
      const token = await deviceAuth("00000000-0000-0000-0000-00000000e001");
      const res = await ctx.app.inject({
        method: "GET",
        url: "/v1/handles/check?handle=carol",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { available: boolean; reason: string | null };
      expect(body.available).toBe(true);
      expect(body.reason).toBeNull();
    });
  });

  it("returns available=false with reason for invalid + reserved + taken", async () => {
    await withFreshRedis(async () => {
      const token = await deviceAuth("00000000-0000-0000-0000-00000000e002");
      // reserve a handle by setting it on the user
      await ctx.app.inject({
        method: "PATCH",
        url: "/v1/me",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { handle: "dora" },
      });

      const invalid = await ctx.app.inject({
        method: "GET",
        url: "/v1/handles/check?handle=BAD",
        headers: { authorization: `Bearer ${token}` },
      });
      expect((invalid.json() as { reason: string }).reason).toBe("invalid_format");

      const reserved = await ctx.app.inject({
        method: "GET",
        url: "/v1/handles/check?handle=admin",
        headers: { authorization: `Bearer ${token}` },
      });
      expect((reserved.json() as { reason: string }).reason).toBe("reserved");

      const taken = await ctx.app.inject({
        method: "GET",
        url: "/v1/handles/check?handle=dora",
        headers: { authorization: `Bearer ${token}` },
      });
      expect((taken.json() as { reason: string }).reason).toBe("taken");
    });
  });
});
