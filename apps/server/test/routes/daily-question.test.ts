import { dailyQuestions, users } from "@/db/schema/index.js";
import { closeRedis } from "@/services/redis.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { truncateAllTables } from "../helpers/db.js";
import { type TestServer, makeTestServer } from "../helpers/server.js";

describe("GET /v1/daily-question", () => {
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
    const res = await ctx.app.inject({ method: "GET", url: "/v1/daily-question" });
    expect(res.statusCode).toBe(401);
  });

  it("returns question=null and points_balance=0 when no question exists", async () => {
    const { token } = await deviceAuth("00000000-0000-0000-0000-00000000da01");
    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/daily-question",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      question: null;
      my_prediction: null;
      points_balance: number;
    };
    expect(body.question).toBeNull();
    expect(body.my_prediction).toBeNull();
    expect(body.points_balance).toBe(0);
  });

  it("returns today's question with my_prediction=null before voting", async () => {
    const { token } = await deviceAuth("00000000-0000-0000-0000-00000000da02");

    const today = new Date().toISOString().slice(0, 10);
    await ctx.db.insert(dailyQuestions).values({
      date: today,
      assetId: "BTC",
      baselinePriceUsd: "50000",
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/daily-question",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      question: { date: string; asset_id: string; direction_resolved: null };
      my_prediction: null;
      points_balance: number;
    };
    expect(body.question?.date).toBe(today);
    expect(body.question?.asset_id).toBe("BTC");
    expect(body.question?.direction_resolved).toBeNull();
    expect(body.my_prediction).toBeNull();
    expect(body.points_balance).toBe(0);
  });

  it("returns my_prediction after the user votes", async () => {
    const { token } = await deviceAuth("00000000-0000-0000-0000-00000000da03");

    const today = new Date().toISOString().slice(0, 10);
    const [question] = await ctx.db
      .insert(dailyQuestions)
      .values({ date: today, assetId: "ETH", baselinePriceUsd: "3000" })
      .returning({ id: dailyQuestions.id });

    if (!question) throw new Error("question insert failed");
    await ctx.app.inject({
      method: "POST",
      url: "/v1/predictions",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: {
        daily_question_id: question.id,
        direction: "up",
        stake: 200,
        idempotency_key: "da03-ik-1",
      },
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/daily-question",
      headers: { authorization: `Bearer ${token}` },
    });
    const body = res.json() as {
      question: { asset_id: string };
      my_prediction: { direction: string; stake: number; status: string };
      points_balance: number;
    };
    expect(body.my_prediction?.direction).toBe("up");
    expect(body.my_prediction?.stake).toBe(200);
    expect(body.my_prediction?.status).toBe("pending");
    expect(body.points_balance).toBe(800);
  });
});

describe("POST /v1/predictions", () => {
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

  async function seedQuestion(db: typeof ctx.db) {
    const today = new Date().toISOString().slice(0, 10);
    const [q] = await db
      .insert(dailyQuestions)
      .values({ date: today, assetId: "BTC", baselinePriceUsd: "50000" })
      .returning({ id: dailyQuestions.id });
    if (!q) throw new Error("seedQuestion: insert failed");
    return q.id;
  }

  it("requires auth", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/predictions",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 201 and deducts stake on first prediction", async () => {
    const { token } = await deviceAuth("00000000-0000-0000-0000-00000000db01");
    const questionId = await seedQuestion(ctx.db);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/predictions",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: {
        daily_question_id: questionId,
        direction: "up",
        stake: 300,
        idempotency_key: "db01-ik-1",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      prediction: { direction: string; stake: number; status: string };
      points_balance: number;
    };
    expect(body.prediction.direction).toBe("up");
    expect(body.prediction.stake).toBe(300);
    expect(body.prediction.status).toBe("pending");
    expect(body.points_balance).toBe(700);
  });

  it("returns 200 on idempotent replay with same idempotency key", async () => {
    const { token } = await deviceAuth("00000000-0000-0000-0000-00000000db02");
    const questionId = await seedQuestion(ctx.db);

    const send = () =>
      ctx.app.inject({
        method: "POST",
        url: "/v1/predictions",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {
          daily_question_id: questionId,
          direction: "down",
          stake: 100,
          idempotency_key: "db02-dup",
        },
      });

    const a = await send();
    const b = await send();
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    const aBody = a.json() as { prediction: { id: string }; points_balance: number };
    const bBody = b.json() as { prediction: { id: string }; points_balance: number };
    expect(bBody.prediction.id).toBe(aBody.prediction.id);
    expect(bBody.points_balance).toBe(aBody.points_balance);
  });

  it("returns 400 question_not_found for an unknown question id", async () => {
    const { token } = await deviceAuth("00000000-0000-0000-0000-00000000db03");

    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/predictions",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: {
        daily_question_id: "00000000-0000-0000-0000-000000000000",
        direction: "up",
        stake: 100,
        idempotency_key: "db03-ik-1",
      },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe("question_not_found");
  });

  it("returns 400 question_resolved for an already-resolved question", async () => {
    const { token } = await deviceAuth("00000000-0000-0000-0000-00000000db04");

    const today = new Date().toISOString().slice(0, 10);
    const [q] = await ctx.db
      .insert(dailyQuestions)
      .values({
        date: today,
        assetId: "SOL",
        baselinePriceUsd: "100",
        directionResolved: "up",
        resolvedAt: new Date(),
      })
      .returning({ id: dailyQuestions.id });
    if (!q) throw new Error("question insert failed");

    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/predictions",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: {
        daily_question_id: q.id,
        direction: "up",
        stake: 100,
        idempotency_key: "db04-ik-1",
      },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe("question_resolved");
  });

  it("returns 422 insufficient_points when balance is exhausted", async () => {
    const { token, userId } = await deviceAuth("00000000-0000-0000-0000-00000000db05");
    const questionId = await seedQuestion(ctx.db);

    const { predictionPoints } = await import("@/db/schema/index.js");
    await ctx.db.insert(predictionPoints).values({ userId, balance: 50 }).onConflictDoNothing();
    await ctx.db
      .update(predictionPoints)
      .set({ balance: 50 })
      .where(eq(predictionPoints.userId, userId));

    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/predictions",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: {
        daily_question_id: questionId,
        direction: "down",
        stake: 100,
        idempotency_key: "db05-ik-1",
      },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: string }).error).toBe("insufficient_points");
  });

  it("rate-limits at 10/min per user — the 11th request returns 429", async () => {
    const { token } = await deviceAuth("00000000-0000-0000-0000-00000000db06");

    const fakePayload = {
      daily_question_id: "00000000-0000-0000-0000-000000000000",
      direction: "up",
      stake: 100,
      idempotency_key: "db06-rl-0",
    };
    for (let i = 0; i < 10; i++) {
      await ctx.app.inject({
        method: "POST",
        url: "/v1/predictions",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { ...fakePayload, idempotency_key: `db06-rl-${i}` },
      });
    }
    const blocked = await ctx.app.inject({
      method: "POST",
      url: "/v1/predictions",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { ...fakePayload, idempotency_key: "db06-rl-10" },
    });
    expect(blocked.statusCode).toBe(429);
  });
});
