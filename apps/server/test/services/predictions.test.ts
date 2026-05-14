import { loadConfig } from "@/config.js";
import { makeDb } from "@/db/client.js";
import { dailyQuestions, predictionPoints, userPredictions, users } from "@/db/schema/index.js";
import {
  awardPayouts,
  getPointsBalance,
  getUserPredictionForQuestion,
  submitPrediction,
} from "@/services/predictions.js";
import { closeRedis } from "@/services/redis.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { truncateAllTables } from "../helpers/db.js";

async function seedQuestionAndUser(db: ReturnType<typeof makeDb>["db"]) {
  const [user] = await db
    .insert(users)
    .values({ deviceUuid: `test-${Math.random().toString(36).slice(2)}` })
    .returning({ id: users.id });
  if (!user) throw new Error("seed: user insert failed");

  const today = new Date().toISOString().slice(0, 10);
  const [question] = await db
    .insert(dailyQuestions)
    .values({ date: today, assetId: "BTC", baselinePriceUsd: "50000" })
    .returning({ id: dailyQuestions.id });
  if (!question) throw new Error("seed: daily_question insert failed");

  return { userId: user.id, questionId: question.id };
}

describe("predictions service", () => {
  const config = loadConfig({
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/paper",
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
    JWT_SECRET: "test-secret-must-be-at-least-32-characters-long",
    LOG_LEVEL: "fatal",
  });
  const handles = makeDb(config.DATABASE_URL, { max: 2 });
  const db = handles.db;

  afterEach(async () => {
    await truncateAllTables(db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  it("getPointsBalance returns 0 for a user with no row", async () => {
    const [user] = await db
      .insert(users)
      .values({ deviceUuid: "bal-0-test" })
      .returning({ id: users.id });
    if (!user) throw new Error("seed: user insert failed");
    const balance = await getPointsBalance(db, user.id);
    expect(balance).toBe(0);
  });

  it("submitPrediction lazy-inits 1000 points and deducts the stake", async () => {
    const { userId, questionId } = await seedQuestionAndUser(db);

    const result = await submitPrediction(db, {
      userId,
      dailyQuestionId: questionId,
      direction: "up",
      stake: 200,
      idempotencyKey: "ik-1",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.wasNew).toBe(true);
    expect(result.newBalance).toBe(800); // 1000 - 200
    expect(result.prediction.direction).toBe("up");
    expect(result.prediction.stake).toBe(200);
    expect(result.prediction.status).toBe("pending");
  });

  it("submitPrediction is idempotent — second call returns existing row and restores balance", async () => {
    const { userId, questionId } = await seedQuestionAndUser(db);

    const first = await submitPrediction(db, {
      userId,
      dailyQuestionId: questionId,
      direction: "up",
      stake: 100,
      idempotencyKey: "ik-dup",
    });

    const second = await submitPrediction(db, {
      userId,
      dailyQuestionId: questionId,
      direction: "up",
      stake: 100,
      idempotencyKey: "ik-dup",
    });

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind !== "ok" || second.kind !== "ok") return;

    expect(second.wasNew).toBe(false);
    expect(second.prediction.id).toBe(first.prediction.id);
    expect(second.newBalance).toBe(first.newBalance);
  });

  it("submitPrediction returns insufficient_points when balance is too low", async () => {
    const { userId, questionId } = await seedQuestionAndUser(db);

    await db.insert(predictionPoints).values({ userId, balance: 50 }).onConflictDoNothing();
    await db
      .update(predictionPoints)
      .set({ balance: 50 })
      .where(eq(predictionPoints.userId, userId));

    const result = await submitPrediction(db, {
      userId,
      dailyQuestionId: questionId,
      direction: "down",
      stake: 100,
      idempotencyKey: "ik-broke",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.code).toBe("insufficient_points");
  });

  it("getUserPredictionForQuestion returns null before any vote", async () => {
    const { userId, questionId } = await seedQuestionAndUser(db);
    const p = await getUserPredictionForQuestion(db, userId, questionId);
    expect(p).toBeNull();
  });

  it("getUserPredictionForQuestion returns the prediction after a vote", async () => {
    const { userId, questionId } = await seedQuestionAndUser(db);

    await submitPrediction(db, {
      userId,
      dailyQuestionId: questionId,
      direction: "down",
      stake: 150,
      idempotencyKey: "ik-get",
    });

    const p = await getUserPredictionForQuestion(db, userId, questionId);
    expect(p?.direction).toBe("down");
    expect(p?.stake).toBe(150);
  });

  it("awardPayouts — correct voters double their stake", async () => {
    const { userId, questionId } = await seedQuestionAndUser(db);

    await submitPrediction(db, {
      userId,
      dailyQuestionId: questionId,
      direction: "up",
      stake: 200,
      idempotencyKey: "ik-award",
    });

    const balanceBefore = await getPointsBalance(db, userId); // 800 after staking 200

    await awardPayouts(db, questionId, "up");

    const balanceAfter = await getPointsBalance(db, userId);
    expect(balanceAfter).toBe(balanceBefore + 400); // stake*2 = 400 credited

    const [prediction] = await db
      .select()
      .from(userPredictions)
      .where(eq(userPredictions.dailyQuestionId, questionId));
    expect(prediction?.status).toBe("correct");
    expect(prediction?.payout).toBe(400);
  });

  it("awardPayouts — wrong voters receive 0 payout", async () => {
    const { userId, questionId } = await seedQuestionAndUser(db);

    await submitPrediction(db, {
      userId,
      dailyQuestionId: questionId,
      direction: "down",
      stake: 100,
      idempotencyKey: "ik-wrong",
    });

    const balanceBefore = await getPointsBalance(db, userId); // 900

    await awardPayouts(db, questionId, "up"); // predicted down, resolved up → wrong

    const balanceAfter = await getPointsBalance(db, userId);
    expect(balanceAfter).toBe(balanceBefore); // no change — wrong payout is 0

    const [prediction] = await db
      .select()
      .from(userPredictions)
      .where(eq(userPredictions.dailyQuestionId, questionId));
    expect(prediction?.status).toBe("wrong");
    expect(prediction?.payout).toBe(0);
  });

  it("awardPayouts — tie voters get their stake refunded", async () => {
    const { userId, questionId } = await seedQuestionAndUser(db);

    await submitPrediction(db, {
      userId,
      dailyQuestionId: questionId,
      direction: "up",
      stake: 300,
      idempotencyKey: "ik-tie",
    });

    const balanceBefore = await getPointsBalance(db, userId); // 700

    await awardPayouts(db, questionId, "tie");

    const balanceAfter = await getPointsBalance(db, userId);
    expect(balanceAfter).toBe(balanceBefore + 300); // stake refunded

    const [prediction] = await db
      .select()
      .from(userPredictions)
      .where(eq(userPredictions.dailyQuestionId, questionId));
    expect(prediction?.status).toBe("tie");
    expect(prediction?.payout).toBe(300);
  });

  it("awardPayouts is idempotent — calling twice does not double-credit", async () => {
    const { userId, questionId } = await seedQuestionAndUser(db);

    await submitPrediction(db, {
      userId,
      dailyQuestionId: questionId,
      direction: "up",
      stake: 200,
      idempotencyKey: "ik-idem",
    });

    await awardPayouts(db, questionId, "up");
    const balanceAfterFirst = await getPointsBalance(db, userId);

    await awardPayouts(db, questionId, "up"); // no pending rows remain
    const balanceAfterSecond = await getPointsBalance(db, userId);

    expect(balanceAfterSecond).toBe(balanceAfterFirst);
  });
});
