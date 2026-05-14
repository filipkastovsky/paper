import { pushSubscriptions } from "@/db/schema/index.js";
import { sendPush, sendToUser, subscribeUser, unsubscribeUser } from "@/services/push.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { truncateAllTables } from "../helpers/db.js";
import { type TestServer, makeTestServer } from "../helpers/server.js";

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue({}),
  },
}));

async function getWebPushMock() {
  const { default: webPush } = await import("web-push");
  return webPush as {
    setVapidDetails: ReturnType<typeof vi.fn>;
    sendNotification: ReturnType<typeof vi.fn>;
  };
}

const TEST_SUB = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint-001",
  p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtwe6YZk7dWLRnWPW5A",
  auth: "tBHItJI5svbpez7KI4CCXg",
};

describe("subscribeUser / unsubscribeUser", () => {
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

  async function seedUser(deviceUuid: string): Promise<string> {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/device",
      payload: { device_uuid: deviceUuid },
    });
    return (res.json() as { user: { id: string } }).user.id;
  }

  it("inserts a subscription row", async () => {
    const userId = await seedUser("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    await subscribeUser(ctx.db, userId, TEST_SUB);

    const rows = await ctx.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.endpoint).toBe(TEST_SUB.endpoint);
    expect(rows[0]?.p256dh).toBe(TEST_SUB.p256dh);
    expect(rows[0]?.auth).toBe(TEST_SUB.auth);
  });

  it("upserts on re-subscribe with same endpoint", async () => {
    const userId = await seedUser("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    await subscribeUser(ctx.db, userId, TEST_SUB);

    const updated = { ...TEST_SUB, p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtwe6YZk7dWLRnWPW5B" };
    await subscribeUser(ctx.db, userId, updated);

    const rows = await ctx.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.p256dh).toBe(updated.p256dh);
  });

  it("unsubscribeUser removes the row", async () => {
    const userId = await seedUser("cccccccc-cccc-cccc-cccc-cccccccccccc");
    await subscribeUser(ctx.db, userId, TEST_SUB);

    await unsubscribeUser(ctx.db, TEST_SUB.endpoint);

    const rows = await ctx.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    expect(rows).toHaveLength(0);
  });

  it("unsubscribeUser is a no-op for unknown endpoint", async () => {
    await expect(
      unsubscribeUser(ctx.db, "https://fcm.googleapis.com/fcm/send/nonexistent"),
    ).resolves.toBeUndefined();
  });
});

describe("sendPush", () => {
  it('returns "ok" when web-push succeeds', async () => {
    const wp = await getWebPushMock();
    wp.sendNotification.mockResolvedValueOnce({});

    const result = await sendPush(TEST_SUB, {
      title: "Test",
      body: "Hello",
      tag: "test",
    });
    expect(result).toBe("ok");
  });

  it('returns "gone" on 410 from push server', async () => {
    const wp = await getWebPushMock();
    const gone = Object.assign(new Error("Subscription expired"), { statusCode: 410 });
    wp.sendNotification.mockRejectedValueOnce(gone);

    const result = await sendPush(TEST_SUB, {
      title: "Test",
      body: "Hello",
      tag: "test",
    });
    expect(result).toBe("gone");
  });

  it("re-throws non-410 errors", async () => {
    const wp = await getWebPushMock();
    const serverErr = Object.assign(new Error("Internal Server Error"), { statusCode: 500 });
    wp.sendNotification.mockRejectedValueOnce(serverErr);

    await expect(sendPush(TEST_SUB, { title: "Test", body: "Hello", tag: "test" })).rejects.toThrow(
      "Internal Server Error",
    );
  });
});

describe("sendToUser", () => {
  let ctx: TestServer;

  beforeAll(async () => {
    ctx = await makeTestServer();
  });

  afterEach(async () => {
    await truncateAllTables(ctx.db);
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await ctx.app.close();
    await ctx.sql.end();
  });

  async function seedUser(deviceUuid: string): Promise<string> {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/device",
      payload: { device_uuid: deviceUuid },
    });
    return (res.json() as { user: { id: string } }).user.id;
  }

  it("returns 0 when user has no subscriptions", async () => {
    const userId = await seedUser("dddddddd-dddd-dddd-dddd-dddddddddddd");
    const sent = await sendToUser(ctx.db, userId, {
      title: "Hi",
      body: "Hello",
      tag: "t",
    });
    expect(sent).toBe(0);
  });

  it("returns count of successfully delivered notifications", async () => {
    const wp = await getWebPushMock();
    wp.sendNotification.mockResolvedValue({});

    const userId = await seedUser("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee");
    const sub2 = { ...TEST_SUB, endpoint: `${TEST_SUB.endpoint}-2` };
    await subscribeUser(ctx.db, userId, TEST_SUB);
    await subscribeUser(ctx.db, userId, sub2);

    const sent = await sendToUser(ctx.db, userId, {
      title: "Hi",
      body: "Hello",
      tag: "t",
    });
    expect(sent).toBe(2);
  });

  it("deletes stale subscriptions (410 Gone) and does not count them", async () => {
    const wp = await getWebPushMock();
    const gone = Object.assign(new Error("Gone"), { statusCode: 410 });
    wp.sendNotification.mockRejectedValueOnce(gone).mockResolvedValueOnce({});

    const userId = await seedUser("ffffffff-ffff-ffff-ffff-ffffffffffff");
    const stale = { ...TEST_SUB, endpoint: `${TEST_SUB.endpoint}-stale` };
    const good = { ...TEST_SUB, endpoint: `${TEST_SUB.endpoint}-good` };
    await subscribeUser(ctx.db, userId, stale);
    await subscribeUser(ctx.db, userId, good);

    const sent = await sendToUser(ctx.db, userId, { title: "Hi", body: "Hello", tag: "t" });
    expect(sent).toBe(1);

    const remaining = await ctx.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.endpoint).toBe(good.endpoint);
  });
});
