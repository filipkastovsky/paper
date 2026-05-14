import { pushSubscriptions } from "@/db/schema/index.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { truncateAllTables } from "../helpers/db.js";
import { type TestServer, makeTestServer } from "../helpers/server.js";

const TEST_ENDPOINT = "https://fcm.googleapis.com/fcm/send/test-endpoint-route-001";

async function deviceAuth(ctx: TestServer, uuid: string): Promise<string> {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/v1/auth/device",
    payload: { device_uuid: uuid },
  });
  return (res.json() as { access_token: string }).access_token;
}

describe("GET /v1/push/vapid-key", () => {
  let ctx: TestServer;

  beforeAll(async () => {
    ctx = await makeTestServer();
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.sql.end();
  });

  it("returns the VAPID public key without auth", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/v1/push/vapid-key" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { vapid_public_key: string };
    expect(body.vapid_public_key).toBe(
      "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
    );
  });
});

describe("POST /v1/push/subscribe", () => {
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

  it("requires auth", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/push/subscribe",
      payload: {
        endpoint: TEST_ENDPOINT,
        p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtwe6YZk7dWLRnWPW5A",
        auth: "tBHItJI5svbpez7KI4CCXg",
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("204 and inserts a subscription row", async () => {
    const token = await deviceAuth(ctx, "11111111-0000-0000-0000-000000000001");
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/push/subscribe",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        endpoint: TEST_ENDPOINT,
        p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtwe6YZk7dWLRnWPW5A",
        auth: "tBHItJI5svbpez7KI4CCXg",
      },
    });
    expect(res.statusCode).toBe(204);

    const rows = await ctx.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, TEST_ENDPOINT));
    expect(rows).toHaveLength(1);
  });

  it("400 when endpoint is not a URL", async () => {
    const token = await deviceAuth(ctx, "11111111-0000-0000-0000-000000000002");
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/push/subscribe",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        endpoint: "not-a-url",
        p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtwe6YZk7dWLRnWPW5A",
        auth: "tBHItJI5svbpez7KI4CCXg",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("idempotent: 204 on re-subscribe with same endpoint", async () => {
    const token = await deviceAuth(ctx, "11111111-0000-0000-0000-000000000003");
    const body = {
      endpoint: TEST_ENDPOINT,
      p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtwe6YZk7dWLRnWPW5A",
      auth: "tBHItJI5svbpez7KI4CCXg",
    };

    const first = await ctx.app.inject({
      method: "POST",
      url: "/v1/push/subscribe",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: body,
    });
    const second = await ctx.app.inject({
      method: "POST",
      url: "/v1/push/subscribe",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: body,
    });

    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(204);

    const rows = await ctx.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, TEST_ENDPOINT));
    expect(rows).toHaveLength(1);
  });
});

describe("POST /v1/push/unsubscribe", () => {
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

  it("requires auth", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/push/unsubscribe",
      payload: { endpoint: TEST_ENDPOINT },
    });
    expect(res.statusCode).toBe(401);
  });

  it("204 and removes the subscription row", async () => {
    const token = await deviceAuth(ctx, "22222222-0000-0000-0000-000000000001");

    await ctx.app.inject({
      method: "POST",
      url: "/v1/push/subscribe",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: {
        endpoint: TEST_ENDPOINT,
        p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtwe6YZk7dWLRnWPW5A",
        auth: "tBHItJI5svbpez7KI4CCXg",
      },
    });

    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/push/unsubscribe",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { endpoint: TEST_ENDPOINT },
    });
    expect(res.statusCode).toBe(204);

    const rows = await ctx.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, TEST_ENDPOINT));
    expect(rows).toHaveLength(0);
  });

  it("204 even when endpoint is unknown (idempotent)", async () => {
    const token = await deviceAuth(ctx, "22222222-0000-0000-0000-000000000002");
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/push/unsubscribe",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { endpoint: "https://fcm.googleapis.com/fcm/send/does-not-exist" },
    });
    expect(res.statusCode).toBe(204);
  });
});
