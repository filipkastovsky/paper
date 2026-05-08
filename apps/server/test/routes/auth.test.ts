import { users } from "@/db/schema/index.js";
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
