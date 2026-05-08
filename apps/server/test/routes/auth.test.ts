import { refreshTokens, users } from "@/db/schema/index.js";
import { hashRefreshToken } from "@/lib/tokens.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { truncateAllTables } from "../helpers/db.js";
import { type TestServer, makeTestServer } from "../helpers/server.js";

describe("POST /v1/auth/device", () => {
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
  });

  it("creates a user on first call and returns tokens", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/device",
      payload: { device_uuid: "11111111-1111-1111-1111-111111111111" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      access_token: string;
      refresh_token: string;
      user: { id: string; handle: string | null };
    };
    expect(body.access_token).toMatch(/^eyJ/);
    expect(body.refresh_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.user.handle).toBeNull();

    const rows = await ctx.db
      .select()
      .from(users)
      .where(eq(users.deviceUuid, "11111111-1111-1111-1111-111111111111"));
    expect(rows).toHaveLength(1);
  });

  it("returns the existing user on subsequent calls (idempotent)", async () => {
    const first = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/device",
      payload: { device_uuid: "22222222-2222-2222-2222-222222222222" },
    });
    const second = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/device",
      payload: { device_uuid: "22222222-2222-2222-2222-222222222222" },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const firstUser = first.json().user as { id: string };
    const secondUser = second.json().user as { id: string };
    expect(firstUser.id).toBe(secondUser.id);
  });

  it("rejects an invalid device_uuid", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/device",
      payload: { device_uuid: "not-a-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /v1/auth/refresh", () => {
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
  });

  async function deviceAuth(deviceUuid: string) {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/device",
      payload: { device_uuid: deviceUuid },
    });
    return res.json() as { access_token: string; refresh_token: string; user: { id: string } };
  }

  it("rotates the refresh token and returns new access + refresh", async () => {
    const auth = await deviceAuth("33333333-3333-3333-3333-333333333333");
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refresh_token: auth.refresh_token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { access_token: string; refresh_token: string };
    expect(body.refresh_token).not.toBe(auth.refresh_token);
    expect(body.access_token).toMatch(/^eyJ/);

    // old refresh token is revoked
    const oldHash = hashRefreshToken(auth.refresh_token);
    const [oldRow] = await ctx.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, oldHash));
    expect(oldRow?.revokedAt).not.toBeNull();
  });

  it("rejects a reused (revoked) refresh token and revokes the entire family", async () => {
    const auth = await deviceAuth("44444444-4444-4444-4444-444444444444");
    // first rotation succeeds
    const firstRotate = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refresh_token: auth.refresh_token },
    });
    expect(firstRotate.statusCode).toBe(200);

    // attempt to reuse the original refresh token
    const replay = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refresh_token: auth.refresh_token },
    });
    expect(replay.statusCode).toBe(401);

    // all tokens in the family are revoked
    const all = await ctx.db.select().from(refreshTokens);
    for (const row of all) {
      expect(row.revokedAt).not.toBeNull();
    }
  });

  it("rejects an unknown refresh token", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refresh_token: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an expired refresh token and revokes the family", async () => {
    const auth = await deviceAuth("55555555-5555-5555-5555-555555555555");
    // Force the token's expiry into the past.
    await ctx.db
      .update(refreshTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(refreshTokens.tokenHash, hashRefreshToken(auth.refresh_token)));

    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refresh_token: auth.refresh_token },
    });
    expect(res.statusCode).toBe(401);

    const all = await ctx.db.select().from(refreshTokens);
    for (const row of all) {
      expect(row.revokedAt).not.toBeNull();
    }
  });

  it("survives concurrent rotation: at most one fresh token issued", async () => {
    const auth = await deviceAuth("66666666-6666-6666-6666-666666666666");
    const [a, b] = await Promise.all([
      ctx.app.inject({
        method: "POST",
        url: "/v1/auth/refresh",
        payload: { refresh_token: auth.refresh_token },
      }),
      ctx.app.inject({
        method: "POST",
        url: "/v1/auth/refresh",
        payload: { refresh_token: auth.refresh_token },
      }),
    ]);
    // One must win, the other must 401 (the loser was replay-detected via the
    // conditional UPDATE returning zero rows).
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 401]);

    // After settling: at most one non-revoked row in the entire family.
    const all = await ctx.db.select().from(refreshTokens);
    const live = all.filter((r) => r.revokedAt === null);
    expect(live.length).toBeLessThanOrEqual(1);
  });
});
