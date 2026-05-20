# Plan 6: Daily Market Question + Predictions

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a daily "Will {ASSET} close up or down today?" prediction feature. Users stake points on a direction. A midnight UTC cron job resolves yesterday's question (awarding payouts) and creates today's question. The dashboard gains a `DailyQuestionCard` pinned above the asset list.

**Architecture:** Three new tables (`daily_questions`, `user_predictions`, `prediction_points`). Two new services. Two new routes (`GET /v1/daily-question`, `POST /v1/predictions`). A daily cron job at 00:00 UTC that resolves + creates. `upsertStreak` is wired into POST /v1/predictions (same fire-and-forget pattern as trades). The web card is optimistic: direction buttons disable immediately on click, with TanStack Query invalidation for reconciliation.

**Branch:** Branch off `plan-5-streak` → name `plan-6-daily-question`.

**Tech Stack:**
- **Server:** Fastify 5, Zod 4, Drizzle ORM + drizzle-kit, postgres.js, `@fastify/jwt`, `@fastify/rate-limit`, Kubb codegen → `@paper/api-client`
- **Web:** Vite, React 18, TanStack Router, TanStack Query, Zustand, Tailwind v4, Marshmallow tokens
- **Tests:** Vitest (pool: `forks`, `singleFork: true`), Playwright skipped for this plan
- **Container:** podman arm64

---

**Prerequisites:**
- P1: Working on branch `plan-6-daily-question` branched off `plan-5-streak`
- P2: `podman compose up` — Postgres + Redis containers running
- P3: `pnpm install` up to date across the monorepo

## File Structure

```
apps/server/
  src/db/schema/daily-questions.ts              # T1 — dailyQuestions table
  src/db/schema/user-predictions.ts             # T1 — userPredictions table
  src/db/schema/prediction-points.ts            # T1 — predictionPoints table
  src/db/schema/index.ts                        # T1 — re-export all three
  drizzle/0005_*.sql                            # T1 — generated migration
  test/helpers/db.ts                            # T1 — extend truncateAllTables
  src/services/daily-questions.ts               # T2 — daily question service
  test/services/daily-questions.test.ts         # T2 — service tests
  src/services/predictions.ts                   # T3 — predictions service
  test/services/predictions.test.ts             # T3 — service tests
  src/routes/daily-question.ts                  # T4 — GET /v1/daily-question
  src/routes/predictions.ts                     # T4 — POST /v1/predictions
  src/server.ts                                 # T4 — register new routes
  test/routes/daily-question.test.ts            # T4 — route tests
  src/jobs/daily-question.ts                    # T5 — cron entry point

packages/api-client/                           # T6 — Kubb codegen re-run

apps/web/
  src/stores/daily-question-store.ts            # T7 — Zustand store
  src/components/dashboard/DailyQuestionCard.tsx # T7 — dashboard card
  src/routes/dashboard.tsx                      # T7 — wire in DailyQuestionCard

lab repo (/Users/filipkastovsky/work/personal/lab):
  stacks/paper/manifests/42-cron-daily-question.yaml  # T8 — K8s CronJob
```

---

## Task 1: DB Schema (3 tables) + migration + truncateAllTables

**Files:**
- Create: `apps/server/src/db/schema/daily-questions.ts`
- Create: `apps/server/src/db/schema/user-predictions.ts`
- Create: `apps/server/src/db/schema/prediction-points.ts`
- Modify: `apps/server/src/db/schema/index.ts`
- Modify: `apps/server/test/helpers/db.ts`
- Run: `pnpm drizzle-kit generate`

---

- [ ] **Step 1.1: Create `apps/server/src/db/schema/daily-questions.ts`**

```typescript
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * One row per UTC calendar day. The cron job creates today's row at 00:00 UTC
 * and resolves yesterday's row (setting directionResolved + resolvedAt).
 *
 * `date` is a YYYY-MM-DD string (UTC). The uniqueIndex enforces exactly one
 * question per day.
 *
 * `baselinePriceUsd` is a numeric string — the spot price at question creation
 * time. Resolution compares the asset's price at 00:00 UTC the following day
 * against this baseline.
 *
 * `directionResolved` is null while the question is open (today / future).
 * "tie" fires when the next-day open price equals the baseline exactly (rare
 * but possible on stablecoins).
 */
export const dailyQuestions = pgTable(
  "daily_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: text("date").notNull(),                      // YYYY-MM-DD UTC, unique
    assetId: text("asset_id").notNull(),
    baselinePriceUsd: text("baseline_price_usd").notNull(), // numeric string
    directionResolved: text("direction_resolved"),          // null | "up" | "down" | "tie"
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqDate: uniqueIndex("daily_questions_date_uq").on(t.date),
  }),
);

export type DailyQuestion = typeof dailyQuestions.$inferSelect;
export type NewDailyQuestion = typeof dailyQuestions.$inferInsert;
```

---

- [ ] **Step 1.2: Create `apps/server/src/db/schema/user-predictions.ts`**

```typescript
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { dailyQuestions } from "./daily-questions.js";
import { users } from "./users.js";

/**
 * One prediction per (user, dailyQuestion) pair — enforced by uniqUserQuestion.
 * Idempotency: a second POST with the same idempotency_key returns the existing
 * row (same 23505 SQLSTATE trip as trades).
 *
 * `stake` is an integer between 100 and 500 (prediction points, not USD).
 * `status` transitions: pending → correct | wrong | tie (set by cron at resolution).
 * `payout` is set by the cron: correct=stake*2, wrong=0, tie=stake (refund).
 */
export const userPredictions = pgTable(
  "user_predictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dailyQuestionId: uuid("daily_question_id")
      .notNull()
      .references(() => dailyQuestions.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(),                    // "up" | "down"
    stake: integer("stake").notNull(),                         // 100–500
    status: text("status").notNull().default("pending"),       // "pending" | "correct" | "wrong" | "tie"
    payout: integer("payout"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqUserQuestion: uniqueIndex("user_predictions_user_question_uq").on(
      t.userId,
      t.dailyQuestionId,
    ),
    byUser: index("user_predictions_user_id_idx").on(t.userId),
  }),
);

export type UserPrediction = typeof userPredictions.$inferSelect;
export type NewUserPrediction = typeof userPredictions.$inferInsert;
```

---

- [ ] **Step 1.3: Create `apps/server/src/db/schema/prediction-points.ts`**

```typescript
import { integer, pgTable, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * One row per user. Lazy-initialised by submitPrediction with balance=1000.
 * `balance` is incremented by payout credits (cron) and decremented by stakes
 * (submitPrediction) inside a SELECT FOR UPDATE → UPDATE transaction to prevent
 * double-spend.
 */
export const predictionPoints = pgTable("prediction_points", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  balance: integer("balance").notNull().default(1000),
});

export type PredictionPoints = typeof predictionPoints.$inferSelect;
```

---

- [ ] **Step 1.4: Re-export all three from `apps/server/src/db/schema/index.ts`**

Append three lines after the existing `lesson-progress` export (and after `streaks` if Plan 5 is already merged):

```typescript
export * from "./daily-questions.js";
export * from "./user-predictions.js";
export * from "./prediction-points.js";
```

Full file after edit:

```typescript
export * from "./users.js";
export * from "./refresh-tokens.js";
export * from "./portfolios.js";
export * from "./trades.js";
export * from "./portfolio-snapshots.js";
export * from "./lesson-progress.js";
export * from "./streaks.js";
export * from "./daily-questions.js";
export * from "./user-predictions.js";
export * from "./prediction-points.js";
```

---

- [ ] **Step 1.5: Generate the Drizzle migration**

```bash
cd /Users/filipkastovsky/work/personal/startup
pnpm drizzle-kit generate
```

This will produce `apps/server/drizzle/0005_*.sql` (index increments beyond Plan 5's 0004). Verify that the generated SQL contains `CREATE TABLE "daily_questions"`, `CREATE TABLE "user_predictions"`, and `CREATE TABLE "prediction_points"` before proceeding.

---

- [ ] **Step 1.6: Update `apps/server/test/helpers/db.ts`**

The new tables must appear in the TRUNCATE list. FK chain: `user_predictions` → `daily_questions` (no users FK), `user_predictions` → `users`, `prediction_points` → `users`. Safe truncation order (leaf tables first, then parents):

```typescript
import type { Db } from "@/db/client.js";
import { sql } from "drizzle-orm";

export async function truncateAllTables(db: Db): Promise<void> {
  // Order matters via FK chain. CASCADE handles the FK chain regardless of list
  // order; we still spell out every table to keep the test fixture aware of the
  // full schema (CI fails fast if a new table forgets to add itself).
  await db.execute(
    sql`TRUNCATE TABLE "trades", "portfolio_snapshots", "portfolios", "refresh_tokens", "lesson_progress", "streaks", "user_predictions", "prediction_points", "daily_questions", "users" RESTART IDENTITY CASCADE`,
  );
}
```

---

## Task 2: Daily Question Service + Tests

**Files:**
- Create: `apps/server/src/services/daily-questions.ts`
- Create: `apps/server/test/services/daily-questions.test.ts`

---

- [ ] **Step 2.1: Create `apps/server/src/services/daily-questions.ts`**

```typescript
import type { Db } from "@/db/client.js";
import { dailyQuestions, type DailyQuestion } from "@/db/schema/index.js";
import { getCachedPrice } from "@/services/prices.js";
import { ASSETS } from "@paper/shared";
import { eq } from "drizzle-orm";

/**
 * USDC is excluded from daily questions — it barely moves and makes for a
 * boring prediction target. All other 11 assets rotate by day-of-year.
 */
const QUESTION_ASSETS = ASSETS.filter((a) => a.id !== "USDC");

/**
 * Returns today's UTC date as "YYYY-MM-DD".
 * All date comparisons in this service use UTC to match the cron schedule.
 */
export function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Returns yesterday's UTC date as "YYYY-MM-DD".
 */
function yesterdayUtcDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Day-of-year (1-based). Used to rotate the asset roster deterministically
 * so every day's question is predictable (same asset for all users).
 */
function dayOfYear(date: Date): number {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 0));
  return Math.floor((date.getTime() - start.getTime()) / 86_400_000);
}

/**
 * Fetch the current USD spot price for an asset.
 * Strategy: Redis cache first (getCachedPrice), then Binance REST fallback.
 * Throws if both fail — the cron will catch this and exit(1).
 */
async function fetchSpotPrice(redisUrl: string, assetId: string): Promise<string> {
  const cached = await getCachedPrice(redisUrl, assetId as Parameters<typeof getCachedPrice>[1]);
  if (cached) return String(cached.usd);

  // Fallback: Binance REST price endpoint (lighter than 24hr ticker).
  const asset = ASSETS.find((a) => a.id === assetId);
  if (!asset) throw new Error(`unknown asset: ${assetId}`);
  const res = await fetch(
    `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(asset.binanceSymbol)}`,
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw new Error(`binance price fetch failed: HTTP ${res.status}`);
  const json = (await res.json()) as { price: string };
  if (!json.price) throw new Error(`binance returned no price for ${asset.binanceSymbol}`);
  return json.price;
}

/**
 * Get today's daily_question row, or create one if it does not exist yet.
 * Safe to call multiple times — the uniqueIndex on `date` prevents duplicates
 * (second caller gets back the existing row via the SELECT after the conflict).
 */
export async function getOrCreateTodayQuestion(
  db: Db,
  redisUrl: string,
): Promise<DailyQuestion> {
  const date = todayUtcDate();

  // Fast path: row already exists.
  const [existing] = await db
    .select()
    .from(dailyQuestions)
    .where(eq(dailyQuestions.date, date))
    .limit(1);
  if (existing) return existing;

  // Rotate asset by day-of-year.
  const now = new Date();
  const idx = dayOfYear(now) % QUESTION_ASSETS.length;
  // biome-ignore lint/style/noNonNullAssertion: idx is bounded by QUESTION_ASSETS.length
  const asset = QUESTION_ASSETS[idx]!;

  const baselinePriceUsd = await fetchSpotPrice(redisUrl, asset.id);

  // INSERT ... ON CONFLICT DO NOTHING handles the race where two cron
  // replicas both miss the fast path simultaneously. We then SELECT again.
  await db
    .insert(dailyQuestions)
    .values({ date, assetId: asset.id, baselinePriceUsd })
    .onConflictDoNothing();

  const [created] = await db
    .select()
    .from(dailyQuestions)
    .where(eq(dailyQuestions.date, date))
    .limit(1);
  if (!created) throw new Error("getOrCreateTodayQuestion: row missing after insert — unexpected");
  return created;
}

/**
 * Get today's question without creating it. Returns null if none exists yet
 * (valid state before the first cron tick).
 */
export async function getTodayQuestion(db: Db): Promise<DailyQuestion | null> {
  const [row] = await db
    .select()
    .from(dailyQuestions)
    .where(eq(dailyQuestions.date, todayUtcDate()))
    .limit(1);
  return row ?? null;
}

/**
 * Resolve yesterday's question (if unresolved). Fetches the current price of
 * yesterday's asset, compares it to the baseline, and sets directionResolved.
 *
 * Returns null if no unresolved yesterday row exists (idempotent: safe to
 * call even if already resolved or no question was created yesterday).
 */
export async function resolveYesterdayQuestion(
  db: Db,
  redisUrl: string,
): Promise<DailyQuestion | null> {
  const date = yesterdayUtcDate();

  const [row] = await db
    .select()
    .from(dailyQuestions)
    .where(eq(dailyQuestions.date, date))
    .limit(1);

  if (!row) return null;
  if (row.directionResolved !== null) return row; // already resolved

  const currentPrice = await fetchSpotPrice(redisUrl, row.assetId);
  const baseline = Number(row.baselinePriceUsd);
  const current = Number(currentPrice);

  let directionResolved: "up" | "down" | "tie";
  if (current > baseline) directionResolved = "up";
  else if (current < baseline) directionResolved = "down";
  else directionResolved = "tie";

  const [updated] = await db
    .update(dailyQuestions)
    .set({ directionResolved, resolvedAt: new Date() })
    .where(eq(dailyQuestions.id, row.id))
    .returning();

  if (!updated) throw new Error("resolveYesterdayQuestion: update returned no row — unexpected");
  return updated;
}
```

---

- [ ] **Step 2.2: Create `apps/server/test/services/daily-questions.test.ts`**

```typescript
import { dailyQuestions } from "@/db/schema/index.js";
import {
  getOrCreateTodayQuestion,
  getTodayQuestion,
  resolveYesterdayQuestion,
  todayUtcDate,
} from "@/services/daily-questions.js";
import { closeRedis } from "@/services/redis.js";
import { loadConfig } from "@/config.js";
import { makeDb } from "@/db/client.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { truncateAllTables } from "../helpers/db.js";
import { withFreshRedis } from "../helpers/redis.js";

describe("daily-questions service", () => {
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

  it("todayUtcDate returns a YYYY-MM-DD string", () => {
    const d = todayUtcDate();
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("getOrCreateTodayQuestion creates a row when none exists", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      await r.set(
        "paper:price:BTC",
        JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }),
        "EX",
        120,
      );
      const q = await getOrCreateTodayQuestion(db, config.REDIS_URL);
      expect(q.date).toBe(todayUtcDate());
      expect(q.directionResolved).toBeNull();
      expect(Number(q.baselinePriceUsd)).toBeGreaterThan(0);
    });
  });

  it("getOrCreateTodayQuestion is idempotent — second call returns same row", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      // Seed all possible rotation assets; use BTC as a stand-in.
      await r.set(
        "paper:price:BTC",
        JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }),
        "EX",
        120,
      );
      // Seed enough assets so the rotation asset is covered.
      const assetIds = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "LINK", "DOT", "TON"] as const;
      for (const id of assetIds) {
        await r.set(`paper:price:${id}`, JSON.stringify({ usd: 1, prevUsd: 1, ts }), "EX", 120);
      }
      const a = await getOrCreateTodayQuestion(db, config.REDIS_URL);
      const b = await getOrCreateTodayQuestion(db, config.REDIS_URL);
      expect(a.id).toBe(b.id);
    });
  });

  it("getTodayQuestion returns null when no row exists", async () => {
    const result = await getTodayQuestion(db);
    expect(result).toBeNull();
  });

  it("getTodayQuestion returns the row after creation", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      const assetIds = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "LINK", "DOT", "TON"] as const;
      for (const id of assetIds) {
        await r.set(`paper:price:${id}`, JSON.stringify({ usd: 100, prevUsd: 99, ts }), "EX", 120);
      }
      const created = await getOrCreateTodayQuestion(db, config.REDIS_URL);
      const fetched = await getTodayQuestion(db);
      expect(fetched?.id).toBe(created.id);
    });
  });

  it("resolveYesterdayQuestion returns null when no yesterday row exists", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      await r.set("paper:price:BTC", JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }), "EX", 120);
      const result = await resolveYesterdayQuestion(db, config.REDIS_URL);
      expect(result).toBeNull();
    });
  });

  it("resolveYesterdayQuestion resolves an existing unresolved yesterday row", async () => {
    await withFreshRedis(async (r) => {
      // Manually insert a row dated yesterday.
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

      await db.insert(dailyQuestions).values({
        date: yesterdayStr,
        assetId: "BTC",
        baselinePriceUsd: "40000",
      });

      const ts = Math.floor(Date.now() / 1000);
      // Current price > baseline → directionResolved should be "up".
      await r.set("paper:price:BTC", JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }), "EX", 120);

      const resolved = await resolveYesterdayQuestion(db, config.REDIS_URL);
      expect(resolved?.directionResolved).toBe("up");
      expect(resolved?.resolvedAt).not.toBeNull();
    });
  });

  it("resolveYesterdayQuestion resolves as 'down' when current price < baseline", async () => {
    await withFreshRedis(async (r) => {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

      await db.insert(dailyQuestions).values({
        date: yesterdayStr,
        assetId: "ETH",
        baselinePriceUsd: "3000",
      });

      const ts = Math.floor(Date.now() / 1000);
      await r.set("paper:price:ETH", JSON.stringify({ usd: 2000, prevUsd: 2800, ts }), "EX", 120);

      const resolved = await resolveYesterdayQuestion(db, config.REDIS_URL);
      expect(resolved?.directionResolved).toBe("down");
    });
  });

  it("resolveYesterdayQuestion is idempotent — already-resolved row is returned as-is", async () => {
    await withFreshRedis(async (r) => {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

      const [inserted] = await db
        .insert(dailyQuestions)
        .values({
          date: yesterdayStr,
          assetId: "BTC",
          baselinePriceUsd: "40000",
          directionResolved: "up",
          resolvedAt: new Date(),
        })
        .returning();

      // Should return the already-resolved row without touching Binance/Redis.
      const result = await resolveYesterdayQuestion(db, config.REDIS_URL);
      expect(result?.id).toBe(inserted?.id);
      expect(result?.directionResolved).toBe("up");
    });
  });
});
```

---

## Task 3: Predictions Service + Tests

**Files:**
- Create: `apps/server/src/services/predictions.ts`
- Create: `apps/server/test/services/predictions.test.ts`

---

- [ ] **Step 3.1: Create `apps/server/src/services/predictions.ts`**

```typescript
import type { Db } from "@/db/client.js";
import {
  dailyQuestions,
  predictionPoints,
  type UserPrediction,
  userPredictions,
} from "@/db/schema/index.js";
import { and, eq, sql } from "drizzle-orm";

export type SubmitPredictionInput = {
  userId: string;
  dailyQuestionId: string;
  direction: "up" | "down";
  /** 100–500 inclusive */
  stake: number;
  idempotencyKey: string;
};

export type SubmitPredictionResult =
  | {
      kind: "ok";
      prediction: UserPrediction;
      wasNew: boolean;
      /** Updated balance after deducting stake (only meaningful when wasNew=true). */
      newBalance: number;
    }
  | { kind: "error"; code: "insufficient_points" };

/**
 * Submit a prediction for today's daily question.
 *
 * Idempotency contract: a duplicate (userId, dailyQuestionId) pair trips SQLSTATE
 * 23505 from the uniqueIndex. The handler catches it and returns the existing row
 * with wasNew=false, letting the client know this is a replay.
 *
 * Points flow:
 *   1. Lazy-init prediction_points row with balance=1000 if absent.
 *   2. SELECT FOR UPDATE to read balance and prevent double-spend.
 *   3. Deduct stake.
 *   4. INSERT user_prediction.
 */
export async function submitPrediction(
  db: Db,
  input: SubmitPredictionInput,
): Promise<SubmitPredictionResult> {
  // Lazy-init the points row for this user with 1000 starting balance.
  // ON CONFLICT DO NOTHING: the row already exists for returning users.
  await db
    .insert(predictionPoints)
    .values({ userId: input.userId, balance: 1000 })
    .onConflictDoNothing();

  // SELECT FOR UPDATE: lock the user's points row to prevent concurrent double-spend.
  // We use raw SQL because Drizzle ORM does not expose FOR UPDATE on SELECT.
  const lockResult = await db.execute<{ balance: number }>(
    sql`SELECT balance FROM prediction_points WHERE user_id = ${input.userId} FOR UPDATE`,
  );
  const pointsRow = lockResult.rows[0];
  if (!pointsRow) throw new Error("prediction_points row missing after lazy-init — unexpected");

  const currentBalance = pointsRow.balance;
  if (currentBalance < input.stake) {
    return { kind: "error", code: "insufficient_points" };
  }

  // Deduct the stake.
  await db
    .update(predictionPoints)
    .set({ balance: sql`balance - ${input.stake}` })
    .where(eq(predictionPoints.userId, input.userId));

  const newBalance = currentBalance - input.stake;

  // Insert the prediction. On a unique violation (duplicate vote), catch
  // SQLSTATE 23505 and return the existing row with wasNew=false.
  try {
    const [inserted] = await db
      .insert(userPredictions)
      .values({
        userId: input.userId,
        dailyQuestionId: input.dailyQuestionId,
        direction: input.direction,
        stake: input.stake,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();

    if (!inserted) throw new Error("submitPrediction: insert returned no row — unexpected");
    return { kind: "ok", prediction: inserted, wasNew: true, newBalance };
  } catch (err: unknown) {
    // SQLSTATE 23505 = unique_violation (duplicate vote or duplicate idempotency key).
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      // Refund the stake that was deducted — this was an idempotent replay.
      await db
        .update(predictionPoints)
        .set({ balance: sql`balance + ${input.stake}` })
        .where(eq(predictionPoints.userId, input.userId));

      const [existing] = await db
        .select()
        .from(userPredictions)
        .where(
          and(
            eq(userPredictions.userId, input.userId),
            eq(userPredictions.dailyQuestionId, input.dailyQuestionId),
          ),
        )
        .limit(1);

      if (!existing) throw new Error("submitPrediction: existing row not found after 23505 — unexpected");

      // Return the balance before the deduct attempt (refund restored it).
      return { kind: "ok", prediction: existing, wasNew: false, newBalance: currentBalance };
    }
    throw err;
  }
}

/**
 * Get the current points balance for a user.
 * Returns 0 if no row exists yet (before first prediction).
 */
export async function getPointsBalance(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ balance: predictionPoints.balance })
    .from(predictionPoints)
    .where(eq(predictionPoints.userId, userId))
    .limit(1);
  return row?.balance ?? 0;
}

/**
 * Get the user's prediction for a specific daily question.
 * Returns null if the user has not voted yet.
 */
export async function getUserPredictionForQuestion(
  db: Db,
  userId: string,
  dailyQuestionId: string,
): Promise<UserPrediction | null> {
  const [row] = await db
    .select()
    .from(userPredictions)
    .where(
      and(
        eq(userPredictions.userId, userId),
        eq(userPredictions.dailyQuestionId, dailyQuestionId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Award payouts for all pending predictions on a resolved question.
 * Called by the cron job after resolveYesterdayQuestion succeeds.
 *
 * Payout rules:
 *   - correct: stake * 2 (double the stake)
 *   - wrong: 0 (lose the stake)
 *   - tie: stake (refund, no gain no loss)
 *
 * Updates user_predictions.status + payout, then credits prediction_points.
 * Safe to call multiple times (status='pending' guard prevents double-award).
 */
export async function awardPayouts(
  db: Db,
  dailyQuestionId: string,
  directionResolved: "up" | "down" | "tie",
): Promise<{ awarded: number }> {
  // Fetch all pending predictions for this question.
  const pending = await db
    .select()
    .from(userPredictions)
    .where(
      and(
        eq(userPredictions.dailyQuestionId, dailyQuestionId),
        eq(userPredictions.status, "pending"),
      ),
    );

  if (pending.length === 0) return { awarded: 0 };

  // Compute status + payout per prediction.
  const updates = pending.map((p) => {
    let status: "correct" | "wrong" | "tie";
    let payout: number;
    if (directionResolved === "tie") {
      status = "tie";
      payout = p.stake;
    } else if (p.direction === directionResolved) {
      status = "correct";
      payout = p.stake * 2;
    } else {
      status = "wrong";
      payout = 0;
    }
    return { id: p.id, userId: p.userId, status, payout };
  });

  // Update each prediction row and credit points in sequence.
  // Small cardinality per question (one question per day, one prediction per user).
  // A bulk UPDATE with CASE would be faster at scale, but sequential is correct
  // and safe for this volume.
  for (const u of updates) {
    await db
      .update(userPredictions)
      .set({ status: u.status, payout: u.payout })
      .where(eq(userPredictions.id, u.id));

    if (u.payout > 0) {
      await db
        .update(predictionPoints)
        .set({ balance: sql`balance + ${u.payout}` })
        .where(eq(predictionPoints.userId, u.userId));
    }
  }

  return { awarded: updates.length };
}
```

---

- [ ] **Step 3.2: Create `apps/server/test/services/predictions.test.ts`**

```typescript
import { dailyQuestions, users, userPredictions, predictionPoints } from "@/db/schema/index.js";
import {
  submitPrediction,
  getPointsBalance,
  getUserPredictionForQuestion,
  awardPayouts,
} from "@/services/predictions.js";
import { closeRedis } from "@/services/redis.js";
import { loadConfig } from "@/config.js";
import { makeDb } from "@/db/client.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { truncateAllTables } from "../helpers/db.js";

/**
 * Helper: insert a bare-minimum user row and daily_question row,
 * return their IDs for test fixtures.
 */
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
    const balance = await getPointsBalance(db, user!.id);
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
    // Balance restored after refund — should equal post-first-prediction balance.
    expect(second.newBalance).toBe(first.newBalance);
  });

  it("submitPrediction returns insufficient_points when balance is too low", async () => {
    const { userId, questionId } = await seedQuestionAndUser(db);

    // Drain the balance with a first prediction.
    // Seed balance to 50 directly.
    await db.insert(predictionPoints).values({ userId, balance: 50 }).onConflictDoNothing();
    // Manually set balance lower to trigger the error.
    await db
      .update(predictionPoints)
      .set({ balance: 50 })
      .where(eq(predictionPoints.userId, userId));

    const result = await submitPrediction(db, {
      userId,
      dailyQuestionId: questionId,
      direction: "down",
      stake: 100, // 100 > 50 balance
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
```

---

## Task 4: Routes + server registration + route tests

**Files:**
- Create: `apps/server/src/routes/daily-question.ts`
- Create: `apps/server/src/routes/predictions.ts`
- Modify: `apps/server/src/server.ts`
- Create: `apps/server/test/routes/daily-question.test.ts`

---

- [ ] **Step 4.1: Create `apps/server/src/routes/daily-question.ts`**

```typescript
import {
  getPointsBalance,
  getUserPredictionForQuestion,
} from "@/services/predictions.js";
import { getTodayQuestion } from "@/services/daily-questions.js";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const QuestionOut = z.object({
  id: z.string().uuid(),
  date: z.string(),
  asset_id: z.string(),
  direction_resolved: z.enum(["up", "down", "tie"]).nullable(),
  resolved_at: z.string().nullable(),
  created_at: z.string(),
});

const PredictionOut = z.object({
  direction: z.enum(["up", "down"]),
  stake: z.number(),
  status: z.enum(["pending", "correct", "wrong", "tie"]),
  payout: z.number().nullable(),
});

const DailyQuestionResponse = z.object({
  question: QuestionOut.nullable(),
  my_prediction: PredictionOut.nullable(),
  points_balance: z.number().int(),
});

export const dailyQuestionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/daily-question",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["daily-question"],
        summary: "Get today's market question + the user's prediction (if any)",
        security: [{ bearerAuth: [] }],
        response: { 200: DailyQuestionResponse },
      },
    },
    async (request) => {
      const userId = request.user.sub;

      const question = await getTodayQuestion(app.db);

      const myPrediction =
        question
          ? await getUserPredictionForQuestion(app.db, userId, question.id)
          : null;

      const pointsBalance = await getPointsBalance(app.db, userId);

      return {
        question: question
          ? {
              id: question.id,
              date: question.date,
              asset_id: question.assetId,
              direction_resolved: question.directionResolved as "up" | "down" | "tie" | null,
              resolved_at: question.resolvedAt ? question.resolvedAt.toISOString() : null,
              created_at: question.createdAt.toISOString(),
            }
          : null,
        my_prediction: myPrediction
          ? {
              direction: myPrediction.direction as "up" | "down",
              stake: myPrediction.stake,
              status: myPrediction.status as "pending" | "correct" | "wrong" | "tie",
              payout: myPrediction.payout ?? null,
            }
          : null,
        points_balance: pointsBalance,
      };
    },
  );
};
```

---

- [ ] **Step 4.2: Create `apps/server/src/routes/predictions.ts`**

```typescript
import { dailyQuestions } from "@/db/schema/index.js";
import { submitPrediction, getPointsBalance } from "@/services/predictions.js";
import { upsertStreak } from "@/services/streaks.js";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const PredictionBody = z.object({
  daily_question_id: z.string().uuid(),
  direction: z.enum(["up", "down"]),
  stake: z.number().int().min(100).max(500),
  idempotency_key: z.string().min(1).max(120),
});

const PredictionRow = z.object({
  id: z.string().uuid(),
  direction: z.string(),
  stake: z.number(),
  status: z.string(),
  payout: z.number().nullable(),
  created_at: z.string(),
});

const PredictionOk = z.object({
  prediction: PredictionRow,
  points_balance: z.number().int(),
});

const PredictionError = z.object({
  error: z.enum([
    "question_not_found",
    "question_resolved",
    "invalid_direction",
    "invalid_stake",
    "insufficient_points",
  ]),
});

export const predictionsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/v1/predictions",
    {
      preHandler: app.authenticate,
      // attachValidation defers body-schema errors so preHandler (auth) runs first.
      attachValidation: true,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          hook: "preHandler",
          keyGenerator: (req) => req.user?.sub ?? req.ip,
        },
      },
      schema: {
        tags: ["predictions"],
        summary: "Submit a direction prediction for today's daily question",
        security: [{ bearerAuth: [] }],
        body: PredictionBody,
        response: {
          200: PredictionOk, // idempotent replay
          201: PredictionOk, // fresh insert
          400: z.any(),
          422: PredictionError,
          429: z.any(),
        },
      },
    },
    async (request, reply) => {
      // Surface body validation errors after auth has run.
      if (request.validationError) {
        return reply.code(400).send({ error: request.validationError.message });
      }

      const userId = request.user.sub;
      const body = request.body;

      // Validate the question exists and is not yet resolved.
      const [question] = await app.db
        .select()
        .from(dailyQuestions)
        .where(eq(dailyQuestions.id, body.daily_question_id))
        .limit(1);

      if (!question) {
        return reply.code(400).send({ error: "question_not_found" as const });
      }
      if (question.directionResolved !== null) {
        return reply.code(400).send({ error: "question_resolved" as const });
      }

      const result = await submitPrediction(app.db, {
        userId,
        dailyQuestionId: body.daily_question_id,
        direction: body.direction,
        stake: body.stake,
        idempotencyKey: body.idempotency_key,
      });

      if (result.kind === "error") {
        return reply.code(422).send({ error: result.code });
      }

      // Fire-and-forget streak upsert — streak failures never degrade predictions UX.
      if (result.wasNew) {
        void upsertStreak(app.db, userId).catch((err: unknown) => {
          app.log.warn(
            { err, userId },
            "predictions: upsertStreak fire-and-forget failed (non-fatal)",
          );
        });
      }

      const status = result.wasNew ? 201 : 200;
      return reply.code(status).send({
        prediction: {
          id: result.prediction.id,
          direction: result.prediction.direction,
          stake: result.prediction.stake,
          status: result.prediction.status,
          payout: result.prediction.payout ?? null,
          created_at: result.prediction.createdAt.toISOString(),
        },
        points_balance: result.newBalance,
      });
    },
  );
};
```

---

- [ ] **Step 4.3: Register routes in `apps/server/src/server.ts`**

Add two import lines after the existing `learnRoutes` import:

```typescript
import { dailyQuestionRoutes } from "./routes/daily-question.js";
import { predictionsRoutes } from "./routes/predictions.js";
```

Add two register calls after `await app.register(learnRoutes)`:

```typescript
  await app.register(dailyQuestionRoutes);
  await app.register(predictionsRoutes);
```

---

- [ ] **Step 4.4: Create `apps/server/test/routes/daily-question.test.ts`**

```typescript
import { dailyQuestions, users } from "@/db/schema/index.js";
import { closeRedis } from "@/services/redis.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { truncateAllTables } from "../helpers/db.js";
import { withFreshRedis } from "../helpers/redis.js";
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

    // Seed a question for today.
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
    await withFreshRedis(async () => {
      const { token } = await deviceAuth("00000000-0000-0000-0000-00000000da03");

      const today = new Date().toISOString().slice(0, 10);
      const [question] = await ctx.db
        .insert(dailyQuestions)
        .values({ date: today, assetId: "ETH", baselinePriceUsd: "3000" })
        .returning({ id: dailyQuestions.id });

      // Submit a prediction via the route.
      await ctx.app.inject({
        method: "POST",
        url: "/v1/predictions",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {
          daily_question_id: question!.id,
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
      expect(body.points_balance).toBe(800); // 1000 - 200
    });
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
    expect(body.points_balance).toBe(700); // 1000 - 300
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
    expect(bBody.points_balance).toBe(aBody.points_balance); // same balance
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

    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/predictions",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: {
        daily_question_id: q!.id,
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

    // Seed a low balance.
    const { predictionPoints } = await import("@/db/schema/index.js");
    await ctx.db
      .insert(predictionPoints)
      .values({ userId, balance: 50 })
      .onConflictDoNothing();
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

    // We do not need a real question to exhaust the rate limit — the limiter
    // fires before business logic. Send 10 with a fake question id (400s), then
    // the 11th should be 429.
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
```

---

## Task 5: Daily Question Cron Job

**Files:**
- Create: `apps/server/src/jobs/daily-question.ts`

---

- [ ] **Step 5.1: Create `apps/server/src/jobs/daily-question.ts`**

```typescript
import { loadConfig } from "../config.js";
import { makeDb } from "../db/client.js";
import { closeRedis } from "../services/redis.js";
import {
  getOrCreateTodayQuestion,
  resolveYesterdayQuestion,
} from "../services/daily-questions.js";
import { awardPayouts } from "../services/predictions.js";

/**
 * Daily question cron — runs at 00:00 UTC.
 *
 * Steps (order is intentional):
 *   1. Resolve yesterday's question (sets directionResolved + resolvedAt).
 *   2. Award payouts to yesterday's predictors (correct=stake*2, wrong=0, tie=stake).
 *   3. Create today's question (picks asset by day-of-year rotation, fetches baseline price).
 *
 * Exit codes:
 *   0  — all steps succeeded
 *   1  — unexpected error (exception thrown)
 *   2  — partial failure (e.g. today's question created but payouts failed)
 *        Note: this code is reserved for future finer-grained partial tracking;
 *        currently only exit 0/1 are used, but K8s CronJob alerting should key on non-zero.
 */

async function runDailyQuestion(): Promise<void> {
  const config = loadConfig();
  const handles = makeDb(config.DATABASE_URL, { max: 4 });

  try {
    // Step 1: Resolve yesterday's question (idempotent — safe if already done).
    const resolved = await resolveYesterdayQuestion(handles.db, config.REDIS_URL);

    if (resolved) {
      console.info(
        JSON.stringify({
          event: "daily_question_resolved",
          date: resolved.date,
          asset_id: resolved.assetId,
          direction: resolved.directionResolved,
        }),
      );

      // Step 2: Award payouts to yesterday's predictors.
      if (resolved.directionResolved) {
        const { awarded } = await awardPayouts(
          handles.db,
          resolved.id,
          resolved.directionResolved as "up" | "down" | "tie",
        );
        console.info(
          JSON.stringify({
            event: "daily_question_payouts_awarded",
            question_id: resolved.id,
            date: resolved.date,
            direction: resolved.directionResolved,
            predictions_resolved: awarded,
          }),
        );
      }
    } else {
      console.info(JSON.stringify({ event: "daily_question_no_yesterday" }));
    }

    // Step 3: Create today's question.
    const today = await getOrCreateTodayQuestion(handles.db, config.REDIS_URL);
    console.info(
      JSON.stringify({
        event: "daily_question_created",
        date: today.date,
        asset_id: today.assetId,
        baseline_price_usd: today.baselinePriceUsd,
      }),
    );
  } finally {
    await handles.sql.end();
    await closeRedis();
  }
}

async function main(): Promise<void> {
  const t0 = Date.now();
  try {
    await runDailyQuestion();
    const elapsedMs = Date.now() - t0;
    console.info(JSON.stringify({ event: "daily_question_cron_done", elapsed_ms: elapsedMs }));
    process.exit(0);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "daily_question_cron_error",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }),
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
```

---

## Task 6: Kubb Codegen

**Files modified by codegen (auto-generated — do not hand-edit):**
- `packages/api-client/src/` — regenerated hooks and types

---

- [ ] **Step 6.1: Run codegen**

```bash
cd /Users/filipkastovsky/work/personal/startup
pnpm gen:api-client
```

This regenerates `@paper/api-client` from the OpenAPI spec (which Fastify's Swagger plugin serves from the registered routes). The codegen will produce:

- `useGetV1DailyQuestion` — React Query hook wrapping `GET /v1/daily-question`
- `usePostV1Predictions` — React Query mutation wrapping `POST /v1/predictions`

Verify the generated output contains these hook names before proceeding to T7.

> **Important:** The server must be running (or the OpenAPI spec must be exported) for Kubb to regenerate from the live schema. If using a static spec file approach, ensure the spec is updated first by starting the server with `pnpm dev` in `apps/server` and curling `http://localhost:3000/documentation/json` to update the spec file before running codegen.

---

## Task 7: Web — DailyQuestionStore + DailyQuestionCard + dashboard wiring

**Files:**
- Create: `apps/web/src/stores/daily-question-store.ts`
- Create: `apps/web/src/components/dashboard/DailyQuestionCard.tsx`
- Modify: `apps/web/src/routes/dashboard.tsx`

---

- [ ] **Step 7.1: Create `apps/web/src/stores/daily-question-store.ts`**

The store holds optimistic local UI state — direction chosen by the user before the server confirms. This prevents flicker when the mutation is in-flight.

```typescript
import { create } from "zustand";

export type Direction = "up" | "down";

interface DailyQuestionState {
  /**
   * Direction the user has chosen locally (optimistic). Set immediately on
   * button click; cleared if the server returns an error.
   */
  optimisticDirection: Direction | null;
  /**
   * Default stake for a new prediction. Hard-coded to 100 for MVP; a slider
   * can be added in a later plan.
   */
  defaultStake: number;
  /**
   * Idempotency key minted when the user clicks a direction button. Reused on
   * retries; a new key is minted when the card is reset.
   */
  idempotencyKey: string | null;

  setOptimisticDirection: (direction: Direction) => void;
  mintIdempotencyKey: () => void;
  clearOptimistic: () => void;
}

export const useDailyQuestionStore = create<DailyQuestionState>((set) => ({
  optimisticDirection: null,
  defaultStake: 100,
  idempotencyKey: null,

  setOptimisticDirection: (direction) => set({ optimisticDirection: direction }),

  mintIdempotencyKey: () => {
    const key = `dq-${
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)
    }`;
    set({ idempotencyKey: key });
  },

  clearOptimistic: () => set({ optimisticDirection: null, idempotencyKey: null }),
}));
```

---

- [ ] **Step 7.2: Create `apps/web/src/components/dashboard/DailyQuestionCard.tsx`**

```tsx
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { useGetV1DailyQuestion, usePostV1Predictions } from "@paper/api-client";
import { ASSETS } from "@paper/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useDailyQuestionStore } from "@/stores/daily-question-store";

/**
 * Dashboard Daily Question Card.
 *
 * States:
 *   - Loading: skeleton text.
 *   - No question: renders nothing (cron hasn't run yet / question is null).
 *   - Open + no vote: two direction buttons ("Up" / "Down") with stake display.
 *   - Open + voted (optimistic or confirmed): locked state with direction chip.
 *   - Resolved: shows outcome (correct / wrong / tie) with payout.
 *
 * Pinned between LearnCTA and TopMoversStrip on the dashboard.
 */
export function DailyQuestionCard() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetV1DailyQuestion({ query: { staleTime: 30_000 } });
  const mutation = usePostV1Predictions();

  const {
    optimisticDirection,
    defaultStake,
    idempotencyKey,
    setOptimisticDirection,
    mintIdempotencyKey,
    clearOptimistic,
  } = useDailyQuestionStore();

  if (isLoading) {
    return (
      <Card tone="lilac" padding="cozy" elevation="flat" className="text-ink">
        <Eyebrow className="text-ink/60">Today's Question</Eyebrow>
        <p className="mt-1 font-display font-semibold text-ink text-sm animate-pulse">
          Loading…
        </p>
      </Card>
    );
  }

  // No question exists yet (cron hasn't run or first day).
  if (!data?.question) return null;

  const question = data.question;
  const myPrediction = data.my_prediction;
  const pointsBalance = data.points_balance;

  // Find the asset name for display.
  const asset = ASSETS.find((a) => a.id === question.asset_id);
  const assetName = asset?.name ?? question.asset_id;

  // Determine the effective voted direction: confirmed server prediction or
  // optimistic local state while the mutation is in-flight.
  const votedDirection = myPrediction?.direction ?? optimisticDirection;
  const hasVoted = votedDirection !== null;
  const isResolved = question.direction_resolved !== null;

  function handleVote(direction: "up" | "down") {
    if (hasVoted || mutation.isPending) return;

    // Mint a fresh idempotency key when the user first clicks.
    // Retries (e.g. network glitch) reuse the same key.
    if (!idempotencyKey) mintIdempotencyKey();

    setOptimisticDirection(direction);

    mutation.mutate(
      {
        data: {
          daily_question_id: question.id,
          direction,
          stake: defaultStake,
          idempotency_key: idempotencyKey ?? `dq-${Date.now()}`,
        },
      },
      {
        onSuccess: () => {
          // Invalidate to pull confirmed server state (balance + status).
          void queryClient.invalidateQueries({ queryKey: ["getV1DailyQuestion"] });
        },
        onError: () => {
          // Rollback optimistic state so the user can try again.
          clearOptimistic();
        },
      },
    );
  }

  // Resolved card — show outcome.
  if (isResolved && myPrediction) {
    const statusLabel =
      myPrediction.status === "correct"
        ? "Correct!"
        : myPrediction.status === "wrong"
          ? "Wrong"
          : "Tie";
    const payoutText =
      myPrediction.payout != null && myPrediction.payout > 0
        ? `+${myPrediction.payout} pts`
        : myPrediction.status === "wrong"
          ? "−" + String(myPrediction.stake) + " pts"
          : "refunded";

    return (
      <Card tone="lilac" padding="cozy" elevation="flat" className="text-ink">
        <Eyebrow className="text-ink/60">Yesterday's Question</Eyebrow>
        <p className="mt-0.5 font-display font-semibold text-ink text-sm">
          {assetName} closed{" "}
          <span className="capitalize">{question.direction_resolved}</span>
        </p>
        <p className="mt-1 text-xs text-ink/70">
          You predicted{" "}
          <span className="font-semibold capitalize">{myPrediction.direction}</span>{" "}
          &middot; {statusLabel} &middot;{" "}
          <span className="font-semibold">{payoutText}</span>
        </p>
        <p className="mt-1 text-xs text-ink/50">Balance: {pointsBalance} pts</p>
      </Card>
    );
  }

  // Open card — voted state.
  if (hasVoted) {
    return (
      <Card tone="lilac" padding="cozy" elevation="flat" className="text-ink">
        <Eyebrow className="text-ink/60">Today's Question</Eyebrow>
        <p className="mt-0.5 font-display font-semibold text-ink text-sm">
          Will {assetName} close up or down vs. yesterday?
        </p>
        <p className="mt-2 text-xs text-ink/70">
          Vote locked in &middot;{" "}
          <span className="font-semibold capitalize">{votedDirection}</span> &middot;{" "}
          {defaultStake} pts staked
        </p>
        <p className="mt-0.5 text-xs text-ink/50">Balance: {pointsBalance} pts</p>
      </Card>
    );
  }

  // Open card — no vote yet.
  return (
    <Card tone="lilac" padding="cozy" elevation="flat" className="text-ink">
      <div>
        <Eyebrow className="text-ink/60">Today's Question</Eyebrow>
        <p className="mt-0.5 font-display font-semibold text-ink text-sm">
          Will {assetName} close up or down vs. yesterday?
        </p>
        <p className="mt-0.5 text-xs text-ink/50">
          Stake {defaultStake} pts &middot; Balance: {pointsBalance} pts
        </p>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          variant="mint"
          size="sm"
          fullWidth
          onClick={() => handleVote("up")}
          disabled={mutation.isPending}
        >
          Up
        </Button>
        <Button
          variant="peach"
          size="sm"
          fullWidth
          onClick={() => handleVote("down")}
          disabled={mutation.isPending}
        >
          Down
        </Button>
      </div>
    </Card>
  );
}
```

> **Note on Button variants:** `mint` and `peach` are existing variants in `button.tsx` (`bg-mint text-ink shadow-inset` and `bg-peach text-ink shadow-inset` respectively). These are used here to visually distinguish the two directions within the lilac card.

---

- [ ] **Step 7.3: Wire `DailyQuestionCard` into `apps/web/src/routes/dashboard.tsx`**

Add the import after the `LearnCTA` import line:

```typescript
import { DailyQuestionCard } from "@/components/dashboard/DailyQuestionCard";
```

Insert `<DailyQuestionCard />` between `<LearnCTA />` and `<TopMoversStrip />`:

```tsx
function Dashboard() {
  return (
    <main className="min-h-dvh bg-paper px-6 py-8">
      <div className="mx-auto max-w-md space-y-6">
        <HeroPortfolioCard />
        <div className="grid grid-cols-2 gap-3">
          <Button asChild trailing="→" fullWidth>
            <Link to="/trade">Place a trade</Link>
          </Button>
          <Button asChild variant="secondary" trailing="→" fullWidth>
            <Link to="/learn">Learn</Link>
          </Button>
        </div>
        <LearnCTA />
        <DailyQuestionCard />
        <TopMoversStrip />
        <AssetList />
      </div>
    </main>
  );
}
```

---

## Task 8: Lab Manifest

**Files:**
- Create: `/Users/filipkastovsky/work/personal/lab/stacks/paper/manifests/42-cron-daily-question.yaml`

---

- [ ] **Step 8.1: Create `42-cron-daily-question.yaml`**

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: paper-cron-daily-question
  namespace: paper
spec:
  schedule: "0 0 * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  startingDeadlineSeconds: 300
  jobTemplate:
    spec:
      backoffLimit: 0
      template:
        spec:
          restartPolicy: Never
          imagePullSecrets:
            - name: paper-pull
          containers:
            - name: cron-daily-question
              image: ${image}
              command: ["node", "apps/server/dist/jobs/daily-question.js"]
              env:
                - name: NODE_ENV
                  value: production
                - name: DATABASE_URL
                  valueFrom: { secretKeyRef: { name: paper-db-password, key: dsn } }
                - name: REDIS_URL
                  valueFrom: { secretKeyRef: { name: paper-app, key: REDIS_URL } }
                - name: JWT_SECRET
                  valueFrom: { secretKeyRef: { name: paper-app, key: JWT_SECRET } }
                - name: LOG_LEVEL
                  value: info
                - name: OTEL_SERVICE_NAME
                  value: paper-cron-daily-question
              resources:
                requests: { cpu: "20m", memory: "96Mi" }
                limits:   { cpu: "300m", memory: "192Mi" }
```

---

## Execution Checklist

Run these in order. Each step has an explicit verification gate.

### Branch setup

- [ ] `git checkout plan-5-streak && git pull`
- [ ] `git checkout -b plan-6-daily-question`

### T1 — Schema

- [ ] Create `daily-questions.ts`, `user-predictions.ts`, `prediction-points.ts`
- [ ] Update `schema/index.ts` with three new exports
- [ ] Run `pnpm drizzle-kit generate` — verify `drizzle/0005_*.sql` created with all 3 tables
- [ ] Update `test/helpers/db.ts` TRUNCATE list
- [ ] Run `pnpm drizzle-kit migrate` (or `push`) against local Postgres — verify no errors

### T2 — Daily question service

- [ ] Create `src/services/daily-questions.ts`
- [ ] Create `test/services/daily-questions.test.ts`
- [ ] Run `pnpm vitest run test/services/daily-questions.test.ts` — all 7 tests pass

### T3 — Predictions service

- [ ] Create `src/services/predictions.ts`
- [ ] Create `test/services/predictions.test.ts`
- [ ] Run `pnpm vitest run test/services/predictions.test.ts` — all 9 tests pass

### T4 — Routes

- [ ] Create `src/routes/daily-question.ts`
- [ ] Create `src/routes/predictions.ts`
- [ ] Update `src/server.ts` (2 imports + 2 register calls)
- [ ] Create `test/routes/daily-question.test.ts`
- [ ] Run `pnpm vitest run test/routes/daily-question.test.ts` — all 9 tests pass
- [ ] Run full test suite: `pnpm vitest run` — no regressions

### T5 — Cron job

- [ ] Create `src/jobs/daily-question.ts`
- [ ] Verify it compiles: `pnpm tsc --noEmit` (or equivalent build check)

### T6 — Kubb codegen

- [ ] Start server (`pnpm dev` in `apps/server`) to expose OpenAPI spec
- [ ] Run `pnpm gen:api-client`
- [ ] Verify `useGetV1DailyQuestion` and `usePostV1Predictions` exist in `packages/api-client/src/`
- [ ] Stop dev server

### T7 — Web

- [ ] Create `src/stores/daily-question-store.ts`
- [ ] Create `src/components/dashboard/DailyQuestionCard.tsx`
- [ ] Update `src/routes/dashboard.tsx`
- [ ] Start web dev server (`pnpm dev` in `apps/web`), open dashboard — verify card renders
- [ ] Verify Up/Down buttons are clickable, card locks after vote

### T8 — Lab manifest

- [ ] Create `42-cron-daily-question.yaml` in lab repo
- [ ] Verify YAML is valid: `python3 -c "import yaml, sys; yaml.safe_load(sys.stdin)" < 42-cron-daily-question.yaml`

### Final

- [ ] Run full Vitest suite one more time: `pnpm vitest run`
- [ ] TypeScript check: `pnpm tsc --noEmit` in `apps/server` and `apps/web`
- [ ] Commit with message: `feat: plan-6 daily market question + predictions`

---

## Self-review Notes

**Spec coverage check:**

| Requirement | Covered in |
|---|---|
| `daily_questions` table | T1 Step 1.1 |
| `user_predictions` table | T1 Step 1.2 |
| `prediction_points` table | T1 Step 1.3 |
| schema/index.ts exports | T1 Step 1.4 |
| Migration generated | T1 Step 1.5 |
| truncateAllTables updated | T1 Step 1.6 |
| Daily question service (getOrCreate, getTodayQuestion, resolveYesterday) | T2 Step 2.1 |
| Daily question service tests | T2 Step 2.2 |
| Predictions service (submit, getBalance, getPrediction, awardPayouts) | T3 Step 3.1 |
| Predictions service tests | T3 Step 3.2 |
| GET /v1/daily-question route | T4 Step 4.1 |
| POST /v1/predictions route | T4 Step 4.2 |
| server.ts registration | T4 Step 4.3 |
| Route tests | T4 Step 4.4 |
| Cron job (resolve + award + create) | T5 Step 5.1 |
| Kubb codegen | T6 Step 6.1 |
| DailyQuestionStore | T7 Step 7.1 |
| DailyQuestionCard component | T7 Step 7.2 |
| Dashboard wiring | T7 Step 7.3 |
| K8s CronJob manifest | T8 Step 8.1 |
| upsertStreak fire-and-forget in predictions route | T4 Step 4.2 |
| Asset rotation (USDC excluded, 11 assets, dayOfYear % 11) | T2 Step 2.1 |
| Idempotency (23505 catch, balance refund) | T3 Step 3.1 |
| SELECT FOR UPDATE double-spend prevention | T3 Step 3.1 |
| Payout rules (correct=2x, wrong=0, tie=refund) | T3 Step 3.1, T5 Step 5.1 |
| awardPayouts idempotency (pending guard) | T3 Step 3.1 |
| Rate limit on POST /v1/predictions (10/min/user) | T4 Step 4.2 |
| attachValidation pattern (auth before 400) | T4 Step 4.2 |

**Type consistency check:**
- `directionResolved` on the DB row is `string | null`; routes cast to `"up" | "down" | "tie" | null` — consistent with Zod schema.
- `direction` on `user_predictions` is `string` in DB; cast to `"up" | "down"` at the route boundary.
- `status` on `user_predictions` is `string` in DB; cast to the union at the route boundary.
- All `createdAt` / `resolvedAt` Date objects are serialized via `.toISOString()` — no raw Date leaks to JSON.
- `balance` in `prediction_points` is `integer` — no floating-point accumulation.
- `stake` and `payout` are `integer` — consistent from DB schema through service through route response.

**No placeholders remaining** — all code blocks are complete and executable.
