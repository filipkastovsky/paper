import { portfolios, users } from "@/db/schema/index.js";
import { currentWeekSunday, recomputeLeaderboard } from "@/services/leaderboard.js";
import { closeRedis } from "@/services/redis.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { truncateAllTables } from "../helpers/db.js";
import { type TestServer, makeTestServer } from "../helpers/server.js";

describe("GET /v1/leaderboard", () => {
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

  it("requires auth — returns 401 without a token", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/v1/leaderboard" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 200 with empty entries when no snapshot rows exist", async () => {
    const { token } = await deviceAuth("00000000-0000-0000-0000-00000000ea01");

    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/leaderboard",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      week_starting_date: string;
      entries: unknown[];
      my_entry: unknown;
    };
    expect(body.entries).toHaveLength(0);
    expect(body.my_entry).toBeNull();
    expect(body.week_starting_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns populated entries after recomputeLeaderboard is called", async () => {
    const { token, userId } = await deviceAuth("00000000-0000-0000-0000-00000000ea02");

    await recomputeLeaderboard(ctx.db, currentWeekSunday());

    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/leaderboard",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      entries: Array<{
        rank: number;
        user_id: string;
        handle: string | null;
        composite_score: number;
      }>;
      my_entry: { rank: number; user_id: string } | null;
    };
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.entries[0]).toMatchObject({
      rank: expect.any(Number),
      user_id: expect.any(String),
      composite_score: expect.any(Number),
    });
    expect(body.my_entry).not.toBeNull();
    expect(body.my_entry?.user_id).toBe(userId);
  });

  it("respects the ?limit query parameter", async () => {
    for (let i = 0; i < 3; i++) {
      await deviceAuth(`00000000-0000-0000-0000-00000000ea0${3 + i}`);
    }
    const { token } = await deviceAuth("00000000-0000-0000-0000-00000000ea06");

    await recomputeLeaderboard(ctx.db, currentWeekSunday());

    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/leaderboard?limit=2",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { entries: unknown[] };
    expect(body.entries).toHaveLength(2);
  });

  it("returns my_entry even when caller is outside the top-N limit", async () => {
    const { token: callerToken, userId: callerId } = await deviceAuth(
      "00000000-0000-0000-0000-00000000ea07",
    );

    const { userId: richA } = await deviceAuth("00000000-0000-0000-0000-00000000ea08");
    const { userId: richB } = await deviceAuth("00000000-0000-0000-0000-00000000ea09");

    await ctx.db
      .update(portfolios)
      .set({ cashUsd: "15000.00000000" })
      .where(eq(portfolios.userId, richA));
    await ctx.db
      .update(portfolios)
      .set({ cashUsd: "14000.00000000" })
      .where(eq(portfolios.userId, richB));

    await recomputeLeaderboard(ctx.db, currentWeekSunday());

    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/leaderboard?limit=2",
      headers: { authorization: `Bearer ${callerToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      entries: Array<{ rank: number }>;
      my_entry: { rank: number; user_id: string } | null;
    };
    expect(body.entries).toHaveLength(2);
    expect(body.my_entry).not.toBeNull();
    expect(body.my_entry?.user_id).toBe(callerId);
    expect(body.my_entry?.rank).toBe(3);
  });

  it("rejects ?limit above 200 with 400", async () => {
    const { token } = await deviceAuth("00000000-0000-0000-0000-00000000ea10");

    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/leaderboard?limit=201",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
  });
});
