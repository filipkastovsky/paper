import { closeRedis } from "@/services/redis.js";
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

  async function deviceAuth(deviceUuid: string): Promise<string> {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/device",
      payload: { device_uuid: deviceUuid },
    });
    const body = res.json() as { access_token: string };
    return body.access_token;
  }

  it("requires auth", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/v1/me" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the current user + a $10k portfolio", async () => {
    await withFreshRedis(async () => {
      const token = await deviceAuth("00000000-0000-0000-0000-00000000c001");
      const res = await ctx.app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        user: { id: string; handle: string | null; avatar: string | null };
        portfolio: { cash_usd: string; holdings: unknown[]; total_value_usd: string };
      };
      expect(body.user.handle).toBeNull();
      expect(body.user.avatar).toBeNull();
      expect(body.portfolio.cash_usd).toBe("10000.00000000");
      expect(body.portfolio.holdings).toEqual([]);
      expect(body.portfolio.total_value_usd).toBe("10000.00000000");
    });
  });
});
