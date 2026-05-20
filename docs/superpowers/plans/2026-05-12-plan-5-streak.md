# Streak System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a per-user daily streak system that rewards consecutive days of learning or trading. A streak row is created or extended when a qualifying action (lesson complete or trade execute) fires. A K8s CronJob reaps broken streaks hourly. The dashboard hero card gains a flame indicator that opens a detail sheet.

**Architecture:** The `streaks` table has a single row per user (PK = `user_id`). `upsertStreak` is called non-blocking (fire-and-forget) from the trades and learn routes after the primary response is sent — streak failures never degrade the core UX. `GET /v1/me` fetches the streak row in parallel with portfolio data and surfaces it as a nullable object. The streak reaper is a standalone Node.js script run as an hourly K8s CronJob.

**Tech Stack:**
- **Server:** Fastify 5, Zod 4, Drizzle ORM, postgres.js, `@fastify/jwt`, `@fastify/rate-limit`, Kubb codegen
- **Web:** Vite, React 18, TanStack Query (`useGetV1Me`), Zustand, Tailwind v4, Marshmallow tokens, Radix Dialog (BottomSheet)
- **Tests:** Vitest (pool: `forks`, `singleFork: true`), Playwright (iPhone 14 viewport)
- **Container:** podman arm64 builds, k3s on Hetzner

---

**Prerequisites:**
- P1: Working on branch `plan-5-daily-engagement` branched off `main` at `047ea0f`
- P2: `podman compose up` — Postgres + Redis containers running
- P3: `pnpm install` up to date across the monorepo

## File Structure

```
apps/server/
  src/db/schema/streaks.ts                  # T1 — streaks Drizzle table
  src/db/schema/index.ts                    # T1 — re-export streaks
  drizzle/0004_*.sql                        # T1 — generated migration (next idx after 0003)
  test/helpers/db.ts                        # T1 — extend truncateAllTables with "streaks"
  src/services/streaks.ts                   # T2 — upsertStreak, reapExpiredStreaks, getStreak
  test/services/streaks.test.ts             # T2 — service-level TDD
  src/routes/trades.ts                      # T3 — non-blocking upsertStreak after trade
  src/routes/learn.ts                       # T3 — non-blocking upsertStreak after lesson complete
  src/routes/me.ts                          # T3 — extend MeResponse with streak field
  test/routes/me.test.ts                    # T3 — streak field assertions in GET /v1/me tests
  src/jobs/streak-reaper.ts                 # T4 — standalone reaper entry point

packages/api-client/                       # T5 — Kubb codegen re-run (MeResponse changed)

apps/web/
  src/components/dashboard/StreakFlame.tsx  # T6 — flame button + BottomSheet detail
  src/components/dashboard/HeroPortfolioCard.tsx  # T6 — integrate StreakFlame

lab repo (/Users/filipkastovsky/work/personal/lab):
  stacks/paper/manifests/41-cron-streak-reaper.yaml  # T7 — K8s CronJob manifest
```

---

### Task 1: `streaks` schema + Drizzle migration + truncateAllTables

**Files:**
- Create: `apps/server/src/db/schema/streaks.ts`
- Modify: `apps/server/src/db/schema/index.ts`
- Modify: `apps/server/test/helpers/db.ts`

- [ ] **Step 1.1: Create `apps/server/src/db/schema/streaks.ts`**

```typescript
import { integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const streaks = pgTable("streaks", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  currentDays: integer("current_days").notNull().default(0),
  longestDays: integer("longest_days").notNull().default(0),
  lastQualifyingActionAt: timestamp("last_qualifying_action_at", { withTimezone: true }).notNull(),
  perfectDaysCount: integer("perfect_days_count").notNull().default(0),
});

export type Streak = typeof streaks.$inferSelect;
export type NewStreak = typeof streaks.$inferInsert;
```

- [ ] **Step 1.2: Re-export from `apps/server/src/db/schema/index.ts`**

Add a new export line after the `lesson-progress` line:

```typescript
export * from "./streaks.js";
```

The full file should read:
```typescript
export * from "./users.js";
export * from "./refresh-tokens.js";
export * from "./portfolios.js";
export * from "./trades.js";
export * from "./portfolio-snapshots.js";
export * from "./lesson-progress.js";
export * from "./streaks.js";
```

- [ ] **Step 1.3: Generate the Drizzle migration**

```bash
cd /Users/filipkastovsky/work/personal/startup
pnpm --filter @paper/server drizzle-kit generate
```

Expected output: a new file `apps/server/drizzle/0004_*.sql` containing `CREATE TABLE "streaks"`. Verify:

```bash
ls apps/server/drizzle/ | grep 0004
# Expected: 0004_<name>.sql
```

Inspect the generated SQL to confirm the table matches the schema (PK on `user_id`, FK with CASCADE DELETE, 4 integer columns, 1 timestamptz column).

- [ ] **Step 1.4: Apply the migration to the local dev DB**

```bash
pnpm --filter @paper/server drizzle-kit migrate
```

Expected: `All migrations applied` (or similar success message from drizzle-kit).

- [ ] **Step 1.5: Update `apps/server/test/helpers/db.ts`**

Add `"streaks"` to the TRUNCATE list immediately after `"lesson_progress"`:

```typescript
import type { Db } from "@/db/client.js";
import { sql } from "drizzle-orm";

export async function truncateAllTables(db: Db): Promise<void> {
  // Order matters via FK chain: trades + portfolio_snapshots + portfolios + refresh_tokens → users.
  // CASCADE handles the FK chain regardless of list order; we still spell out every table to keep
  // the test fixture aware of the full schema (CI fails fast if a new table forgets to add itself).
  await db.execute(
    sql`TRUNCATE TABLE "trades", "portfolio_snapshots", "portfolios", "refresh_tokens", "lesson_progress", "streaks", "users" RESTART IDENTITY CASCADE`,
  );
}
```

- [ ] **Step 1.6: Verify TypeScript compiles**

```bash
cd /Users/filipkastovsky/work/personal/startup
pnpm --filter @paper/server tsc --noEmit
```

Expected: no errors.

- [ ] **Step 1.7: Commit**

```bash
git add apps/server/src/db/schema/streaks.ts \
        apps/server/src/db/schema/index.ts \
        apps/server/drizzle/ \
        apps/server/test/helpers/db.ts
git commit -m "feat(db): add streaks table and migration 0004"
```

---

### Task 2: Streak service + tests (TDD)

**Files:**
- Create: `apps/server/src/services/streaks.ts`
- Create: `apps/server/test/services/streaks.test.ts`

- [ ] **Step 2.1: Write failing tests first — create `apps/server/test/services/streaks.test.ts`**

```typescript
import { makeDb } from "@/db/client.js";
import { users } from "@/db/schema/index.js";
import { getStreak, reapExpiredStreaks, upsertStreak } from "@/services/streaks.js";
import { closeRedis } from "@/services/redis.js";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { truncateAllTables } from "../helpers/db.js";

const dbUrl = process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/paper";

describe("upsertStreak", () => {
  const handles = makeDb(dbUrl, { max: 2 });

  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  async function seedUser(uuid: string): Promise<string> {
    const [u] = await handles.db
      .insert(users)
      .values({ deviceUuid: uuid })
      .returning({ id: users.id });
    if (!u) throw new Error("no user");
    return u.id;
  }

  it("first qualifying action creates a streak row with currentDays=1, wasIncremented=true", async () => {
    const userId = await seedUser("00000000-0000-0000-0000-00000000sr01");
    const result = await upsertStreak(handles.db, userId);
    expect(result.currentDays).toBe(1);
    expect(result.longestDays).toBe(1);
    expect(result.wasIncremented).toBe(true);

    const row = await getStreak(handles.db, userId);
    expect(row).not.toBeNull();
    expect(row?.currentDays).toBe(1);
  });

  it("calling upsertStreak twice on the same UTC day is a no-op on days (wasIncremented=false)", async () => {
    const userId = await seedUser("00000000-0000-0000-0000-00000000sr02");
    const first = await upsertStreak(handles.db, userId);
    expect(first.wasIncremented).toBe(true);
    expect(first.currentDays).toBe(1);

    const second = await upsertStreak(handles.db, userId);
    expect(second.wasIncremented).toBe(false);
    expect(second.currentDays).toBe(1);
  });

  it("action on the next UTC day extends currentDays to 2 and updates longestDays", async () => {
    const userId = await seedUser("00000000-0000-0000-0000-00000000sr03");

    // Insert streak row with lastQualifyingActionAt set to yesterday UTC
    await upsertStreak(handles.db, userId);

    // Manually backdate lastQualifyingActionAt to yesterday to simulate next-day call
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const { streaks } = await import("@/db/schema/index.js");
    const { eq } = await import("drizzle-orm");
    await handles.db
      .update(streaks)
      .set({ lastQualifyingActionAt: yesterday })
      .where(eq(streaks.userId, userId));

    const result = await upsertStreak(handles.db, userId);
    expect(result.currentDays).toBe(2);
    expect(result.longestDays).toBe(2);
    expect(result.wasIncremented).toBe(true);
  });

  it("action after a two-day gap resets currentDays to 1 but preserves longestDays", async () => {
    const userId = await seedUser("00000000-0000-0000-0000-00000000sr04");
    await upsertStreak(handles.db, userId);

    // Backdate to 2 days ago to simulate a broken streak
    const twoDaysAgo = new Date();
    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);
    const { streaks } = await import("@/db/schema/index.js");
    const { eq } = await import("drizzle-orm");
    await handles.db
      .update(streaks)
      .set({ lastQualifyingActionAt: twoDaysAgo, currentDays: 5, longestDays: 5 })
      .where(eq(streaks.userId, userId));

    const result = await upsertStreak(handles.db, userId);
    expect(result.currentDays).toBe(1);
    expect(result.longestDays).toBe(5);
    expect(result.wasIncremented).toBe(true);
  });

  it("longestDays is updated when currentDays surpasses it", async () => {
    const userId = await seedUser("00000000-0000-0000-0000-00000000sr05");
    await upsertStreak(handles.db, userId);

    // Seed an existing streak at 9 days, longest at 9
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const { streaks } = await import("@/db/schema/index.js");
    const { eq } = await import("drizzle-orm");
    await handles.db
      .update(streaks)
      .set({ lastQualifyingActionAt: yesterday, currentDays: 9, longestDays: 9 })
      .where(eq(streaks.userId, userId));

    const result = await upsertStreak(handles.db, userId);
    expect(result.currentDays).toBe(10);
    expect(result.longestDays).toBe(10);
  });
});

describe("getStreak", () => {
  const handles = makeDb(dbUrl, { max: 2 });

  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  it("returns null when no streak row exists for the user", async () => {
    const [u] = await handles.db
      .insert(users)
      .values({ deviceUuid: "00000000-0000-0000-0000-00000000sr06" })
      .returning({ id: users.id });
    if (!u) throw new Error("no user");
    const row = await getStreak(handles.db, u.id);
    expect(row).toBeNull();
  });
});

describe("reapExpiredStreaks", () => {
  const handles = makeDb(dbUrl, { max: 2 });

  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  it("sets currentDays=0 for users whose lastQualifyingActionAt is older than 24h", async () => {
    const [u] = await handles.db
      .insert(users)
      .values({ deviceUuid: "00000000-0000-0000-0000-00000000sr07" })
      .returning({ id: users.id });
    if (!u) throw new Error("no user");

    // Insert a stale streak — last action was 25 hours ago
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const { streaks } = await import("@/db/schema/index.js");
    await handles.db.insert(streaks).values({
      userId: u.id,
      currentDays: 7,
      longestDays: 7,
      lastQualifyingActionAt: stale,
    });

    const reaped = await reapExpiredStreaks(handles.db);
    expect(reaped).toBe(1);

    const row = await getStreak(handles.db, u.id);
    expect(row?.currentDays).toBe(0);
    // longestDays is preserved — the reaper only zeros currentDays
    expect(row?.longestDays).toBe(7);
  });

  it("does not touch users whose lastQualifyingActionAt is within 24h", async () => {
    const [u] = await handles.db
      .insert(users)
      .values({ deviceUuid: "00000000-0000-0000-0000-00000000sr08" })
      .returning({ id: users.id });
    if (!u) throw new Error("no user");

    // Last action was 23 hours ago — still alive
    const recent = new Date(Date.now() - 23 * 60 * 60 * 1000);
    const { streaks } = await import("@/db/schema/index.js");
    await handles.db.insert(streaks).values({
      userId: u.id,
      currentDays: 3,
      longestDays: 3,
      lastQualifyingActionAt: recent,
    });

    const reaped = await reapExpiredStreaks(handles.db);
    expect(reaped).toBe(0);

    const row = await getStreak(handles.db, u.id);
    expect(row?.currentDays).toBe(3);
  });

  it("does not touch users whose currentDays is already 0", async () => {
    const [u] = await handles.db
      .insert(users)
      .values({ deviceUuid: "00000000-0000-0000-0000-00000000sr09" })
      .returning({ id: users.id });
    if (!u) throw new Error("no user");

    const stale = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const { streaks } = await import("@/db/schema/index.js");
    await handles.db.insert(streaks).values({
      userId: u.id,
      currentDays: 0,
      longestDays: 5,
      lastQualifyingActionAt: stale,
    });

    const reaped = await reapExpiredStreaks(handles.db);
    expect(reaped).toBe(0);
  });
});
```

- [ ] **Step 2.2: Run tests — expect failures (service not yet implemented)**

```bash
cd /Users/filipkastovsky/work/personal/startup
pnpm --filter @paper/server vitest run test/services/streaks.test.ts
```

Expected: all tests fail with import errors (`Cannot find module '@/services/streaks.js'`).

- [ ] **Step 2.3: Implement `apps/server/src/services/streaks.ts`**

```typescript
import type { Db } from "@/db/client.js";
import { streaks } from "@/db/schema/index.js";
import { and, gt, lt } from "drizzle-orm";
import { eq } from "drizzle-orm";

export type UpsertStreakResult = {
  currentDays: number;
  longestDays: number;
  wasIncremented: boolean;
};

export async function upsertStreak(db: Db, userId: string): Promise<UpsertStreakResult> {
  const now = new Date();
  const todayUtc = now.toISOString().slice(0, 10); // YYYY-MM-DD

  const [existing] = await db.select().from(streaks).where(eq(streaks.userId, userId));

  if (!existing) {
    await db.insert(streaks).values({
      userId,
      currentDays: 1,
      longestDays: 1,
      lastQualifyingActionAt: now,
    });
    return { currentDays: 1, longestDays: 1, wasIncremented: true };
  }

  const lastUtc = existing.lastQualifyingActionAt.toISOString().slice(0, 10);
  if (lastUtc === todayUtc) {
    // Already counted today — update timestamp so the reaper's 24h window stays warm
    await db
      .update(streaks)
      .set({ lastQualifyingActionAt: now })
      .where(eq(streaks.userId, userId));
    return {
      currentDays: existing.currentDays,
      longestDays: existing.longestDays,
      wasIncremented: false,
    };
  }

  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayUtc = yesterday.toISOString().slice(0, 10);
  const isExtension = lastUtc === yesterdayUtc;

  const newCurrent = isExtension ? existing.currentDays + 1 : 1;
  const newLongest = Math.max(existing.longestDays, newCurrent);

  await db
    .update(streaks)
    .set({ currentDays: newCurrent, longestDays: newLongest, lastQualifyingActionAt: now })
    .where(eq(streaks.userId, userId));

  return { currentDays: newCurrent, longestDays: newLongest, wasIncremented: true };
}

export async function reapExpiredStreaks(db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await db
    .update(streaks)
    .set({ currentDays: 0 })
    .where(and(lt(streaks.lastQualifyingActionAt, cutoff), gt(streaks.currentDays, 0)))
    .returning({ userId: streaks.userId });
  return result.length;
}

export async function getStreak(db: Db, userId: string) {
  const [row] = await db.select().from(streaks).where(eq(streaks.userId, userId));
  return row ?? null;
}
```

- [ ] **Step 2.4: Run tests — expect all to pass**

```bash
pnpm --filter @paper/server vitest run test/services/streaks.test.ts
```

Expected output: all test suites pass (`upsertStreak`, `getStreak`, `reapExpiredStreaks`).

- [ ] **Step 2.5: Commit**

```bash
git add apps/server/src/services/streaks.ts \
        apps/server/test/services/streaks.test.ts
git commit -m "feat(server): streak service with upsert, reap, and get"
```

---

### Task 3: Wire streak into routes + extend GET /v1/me

**Files:**
- Modify: `apps/server/src/routes/trades.ts`
- Modify: `apps/server/src/routes/learn.ts`
- Modify: `apps/server/src/routes/me.ts`
- Modify: `apps/server/test/routes/me.test.ts`

- [ ] **Step 3.1: Write a failing test for GET /v1/me streak field**

Open `apps/server/test/routes/me.test.ts` and add the following test inside the `describe("GET /v1/me")` block (after the existing `returns the current user + a $10k portfolio` test):

```typescript
it("returns streak: null when no qualifying action has been taken", async () => {
  const { token } = await deviceAuth("00000000-0000-0000-0000-00000000me10");
  const res = await ctx.app.inject({
    method: "GET",
    url: "/v1/me",
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as {
    streak: { current_days: number; longest_days: number; perfect_days_count: number } | null;
  };
  expect(body.streak).toBeNull();
});

it("returns streak data after a qualifying action", async () => {
  await withFreshRedis(async (r) => {
    const ts = Math.floor(Date.now() / 1000);
    await r.set(
      "paper:price:BTC",
      JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }),
      "EX",
      120,
    );
    const { token } = await deviceAuth("00000000-0000-0000-0000-00000000me11");
    // Execute a trade to trigger streak upsert
    await ctx.app.inject({
      method: "POST",
      url: "/v1/trades",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: {
        asset_id: "BTC",
        side: "buy",
        usd_amount: "10.00",
        idempotency_key: "k-streak-me",
      },
    });

    // Give the fire-and-forget a tick to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      streak: { current_days: number; longest_days: number; perfect_days_count: number } | null;
    };
    expect(body.streak).not.toBeNull();
    expect(body.streak?.current_days).toBe(1);
    expect(body.streak?.longest_days).toBe(1);
    expect(body.streak?.perfect_days_count).toBe(0);
  });
});
```

- [ ] **Step 3.2: Run the new tests — expect failures**

```bash
pnpm --filter @paper/server vitest run test/routes/me.test.ts
```

Expected: the new tests fail — `streak` key is missing from the response.

- [ ] **Step 3.3: Extend `apps/server/src/routes/me.ts`**

At the top of the file, add the import for `getStreak`:

```typescript
import { getStreak } from "@/services/streaks.js";
```

After the existing `MePortfolio` Zod schema, add:

```typescript
const StreakData = z.object({
  current_days: z.number().int(),
  longest_days: z.number().int(),
  perfect_days_count: z.number().int(),
});
```

Replace the existing `MeResponse` definition:

```typescript
const MeResponse = z.object({
  user: MeUser,
  portfolio: MePortfolio,
  streak: StreakData.nullable(),
});
```

In the `GET /v1/me` handler, after building `p` and `pct`, add the streak fetch and extend the return value:

```typescript
const streakRow = await getStreak(app.db, userId);

return {
  user: { id: u.id, handle: u.handle, avatar: u.avatar },
  portfolio: {
    cash_usd: p.cash_usd,
    holdings: p.holdings,
    total_value_usd: p.total_value_usd,
    today_pct_change: pct,
  },
  streak: streakRow
    ? {
        current_days: streakRow.currentDays,
        longest_days: streakRow.longestDays,
        perfect_days_count: streakRow.perfectDaysCount,
      }
    : null,
};
```

The complete updated `GET /v1/me` handler:

```typescript
async (request, reply) => {
  const userId = request.user.sub;
  const [u] = await app.db.select().from(users).where(eq(users.id, userId));
  if (!u) return reply.code(404).send({ error: "user_not_found" as const });

  let p = await getPortfolioWithValuation(app.db, app.config.REDIS_URL, userId);
  if (!p) {
    await initializePortfolio(app.db, userId);
    p = await getPortfolioWithValuation(app.db, app.config.REDIS_URL, userId);
  }
  if (!p) throw new Error("portfolio init failed for authenticated user");

  const pct = await todayPctChange(app.db, {
    userId,
    currentTotalUsd: p.total_value_usd,
  });

  const streakRow = await getStreak(app.db, userId);

  return {
    user: { id: u.id, handle: u.handle, avatar: u.avatar },
    portfolio: {
      cash_usd: p.cash_usd,
      holdings: p.holdings,
      total_value_usd: p.total_value_usd,
      today_pct_change: pct,
    },
    streak: streakRow
      ? {
          current_days: streakRow.currentDays,
          longest_days: streakRow.longestDays,
          perfect_days_count: streakRow.perfectDaysCount,
        }
      : null,
  };
},
```

- [ ] **Step 3.4: Wire streak into `apps/server/src/routes/trades.ts`**

Add import at the top of the file:

```typescript
import { upsertStreak } from "@/services/streaks.js";
```

In the `POST /v1/trades` handler, replace the final `return reply...` line with:

```typescript
// Streak upsert is non-blocking — kick off before returning so it doesn't delay the response
void upsertStreak(app.db, userId).catch((err) => {
  app.log.warn({ err }, "streak upsert failed after trade");
});
return reply.code(status).send({ trade: wire, is_first_trade: result.isFirstTrade });
```

The surrounding context (complete block replacing the last three lines of the handler):

```typescript
      const wire = toWire(result.trade);
      const status = result.wasIdempotentReplay ? 200 : 201;
      // Streak upsert is non-blocking — kick off before returning so it doesn't delay the response
      void upsertStreak(app.db, userId).catch((err) => {
        app.log.warn({ err }, "streak upsert failed after trade");
      });
      return reply.code(status).send({ trade: wire, is_first_trade: result.isFirstTrade });
```

- [ ] **Step 3.5: Wire streak into `apps/server/src/routes/learn.ts`**

Add import at the top of the file:

```typescript
import { upsertStreak } from "@/services/streaks.js";
```

In the `POST /v1/lessons/:id/complete` handler, replace the final `return reply.code(status).send(...)` with:

```typescript
      // Streak upsert is non-blocking — kick off before returning so it doesn't delay the response
      void upsertStreak(app.db, request.user.sub).catch((err) => {
        app.log.warn({ err }, "streak upsert failed after lesson complete");
      });
      return reply.code(status).send({
        progress: {
          lesson_id: result.progress.lessonId,
          quiz_score: result.progress.quizScore,
          completed_at: result.progress.completedAt.toISOString(),
          updated_at: result.progress.updatedAt.toISOString(),
        },
        is_first_lesson: result.isFirstLesson,
        track_just_completed: result.trackJustCompleted,
      });
```

- [ ] **Step 3.6: Run all route tests**

```bash
pnpm --filter @paper/server vitest run test/routes/
```

Expected: all tests pass, including the two new streak tests in `me.test.ts`.

- [ ] **Step 3.7: Run full service + route test suite**

```bash
pnpm --filter @paper/server vitest run
```

Expected: all tests pass.

- [ ] **Step 3.8: Commit**

```bash
git add apps/server/src/routes/trades.ts \
        apps/server/src/routes/learn.ts \
        apps/server/src/routes/me.ts \
        apps/server/test/routes/me.test.ts
git commit -m "feat(server): wire streak into trades + learn routes, extend GET /v1/me"
```

---

### Task 4: Streak reaper cron job

**Files:**
- Create: `apps/server/src/jobs/streak-reaper.ts`

- [ ] **Step 4.1: Create `apps/server/src/jobs/streak-reaper.ts`**

```typescript
import { loadConfig } from "../config.js";
import { makeDb } from "../db/client.js";
import { reapExpiredStreaks } from "../services/streaks.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const handles = makeDb(config.DATABASE_URL, { max: 2 });
  const t0 = Date.now();
  try {
    const reaped = await reapExpiredStreaks(handles.db);
    console.info(
      JSON.stringify({ event: "streak_reaper_done", reaped, elapsed_ms: Date.now() - t0 }),
    );
    process.exit(0);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "streak_reaper_error",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    process.exit(1);
  } finally {
    await handles.sql.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
```

- [ ] **Step 4.2: Typecheck**

```bash
pnpm --filter @paper/server tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4.3: Commit**

```bash
git add apps/server/src/jobs/streak-reaper.ts
git commit -m "feat(server): streak-reaper cron job entry point"
```

---

### Task 5: Kubb codegen — regenerate `@paper/api-client`

The `GET /v1/me` response schema has changed (added `streak` field). The generated client must reflect this.

**Files:**
- Modify: `packages/api-client/src/` (auto-generated — do not hand-edit)

- [ ] **Step 5.1: Build the server types so Kubb can read the OpenAPI spec**

```bash
pnpm --filter @paper/server build
```

Expected: `apps/server/dist/` is populated.

- [ ] **Step 5.2: Run Kubb codegen**

```bash
pnpm --filter @paper/api-client generate
```

Expected: files in `packages/api-client/src/` are regenerated. The `useGetV1Me` hook's return type now includes `streak: { current_days: number; longest_days: number; perfect_days_count: number } | null`.

- [ ] **Step 5.3: Verify the generated types include the streak field**

```bash
grep -n "streak" packages/api-client/src/types/GetV1Me*.ts
# Expected: lines referencing streak, current_days, longest_days, perfect_days_count
```

- [ ] **Step 5.4: Build the api-client package**

```bash
pnpm --filter @paper/api-client build
```

Expected: no errors.

- [ ] **Step 5.5: Commit**

```bash
git add packages/api-client/src/
git commit -m "chore(api-client): regenerate after GET /v1/me streak extension"
```

---

### Task 6: Web — `StreakFlame` component + `HeroPortfolioCard` update

**Files:**
- Create: `apps/web/src/components/dashboard/StreakFlame.tsx`
- Modify: `apps/web/src/components/dashboard/HeroPortfolioCard.tsx`

- [ ] **Step 6.1: Create `apps/web/src/components/dashboard/StreakFlame.tsx`**

```tsx
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useState } from "react";

export function StreakFlame({
  currentDays,
  longestDays,
}: {
  currentDays: number;
  longestDays: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 font-display text-sm font-semibold text-paper"
        aria-label={`${currentDays}-day streak`}
      >
        🔥 {currentDays}
      </button>
      <BottomSheet open={open} onOpenChange={setOpen} title="Your streak">
        <div className="space-y-4 font-display">
          <div className="text-center">
            <p className="text-6xl">🔥</p>
            <p className="mt-2 text-3xl font-bold text-ink">{currentDays}</p>
            <p className="text-sm text-ink-soft">day streak</p>
          </div>
          <div className="flex justify-center gap-6 border-t border-line pt-4">
            <div className="text-center">
              <p className="text-xl font-bold text-ink">{longestDays}</p>
              <p className="text-xs text-ink-soft">longest</p>
            </div>
          </div>
          <p className="text-center text-xs text-ink-soft">
            Complete a lesson, trade, or daily prediction every day to keep your streak alive.
          </p>
        </div>
      </BottomSheet>
    </>
  );
}
```

- [ ] **Step 6.2: Update `apps/web/src/components/dashboard/HeroPortfolioCard.tsx`**

Add the `StreakFlame` import after the existing imports:

```tsx
import { StreakFlame } from "@/components/dashboard/StreakFlame";
```

Add streak data extraction after the existing `pct` line:

```tsx
const streak = data?.streak ?? null;
```

Wrap the `Eyebrow` in a flex row and conditionally render `StreakFlame`. Replace the `<div className="relative">` block:

```tsx
      <div className="relative">
        <div className="flex items-start justify-between">
          <Eyebrow className="text-paper/55">{handle ? `@${handle}` : "your portfolio"}</Eyebrow>
          {streak && streak.current_days > 0 ? (
            <StreakFlame currentDays={streak.current_days} longestDays={streak.longest_days} />
          ) : null}
        </div>
        <div className="mt-2">
          <BalanceNumeral value={total} size="lg" softDecimal className="block text-paper" />
        </div>
        <Eyebrow rule className={cn("mt-4", pctClass)}>
          {pctText}
        </Eyebrow>
      </div>
```

The complete updated `HeroPortfolioCard.tsx`:

```tsx
import { StreakFlame } from "@/components/dashboard/StreakFlame";
import { BalanceNumeral } from "@/components/ui/balance-numeral";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/cn";
import { parseCash } from "@/lib/currency";
import { useGetV1Me } from "@paper/api-client";

export function HeroPortfolioCard() {
  const { data, isLoading } = useGetV1Me({ query: { staleTime: 15_000 } });
  const total = data ? parseCash(data.portfolio.total_value_usd) : 10000;
  const handle = data?.user.handle ?? null;
  const pct = data?.portfolio.today_pct_change ?? null;
  const streak = data?.streak ?? null;

  const pctClass =
    pct == null
      ? "text-paper/60"
      : pct > 0
        ? "text-mint"
        : pct < 0
          ? "text-peach"
          : "text-paper/60";
  const pctText =
    pct == null
      ? isLoading
        ? "loading…"
        : "— today"
      : `${pct > 0 ? "+" : ""}${pct.toFixed(2)}% today`;

  return (
    <Card tone="ink" elevation="float" padding="lush" className="relative isolate text-paper">
      <span
        aria-hidden
        className="-top-14 -right-12 pointer-events-none absolute h-44 w-44 rounded-full bg-peach opacity-45 blur-3xl"
      />
      <span
        aria-hidden
        className="-bottom-16 -left-12 pointer-events-none absolute h-48 w-48 rounded-full bg-mint opacity-35 blur-3xl"
      />
      <div className="relative">
        <div className="flex items-start justify-between">
          <Eyebrow className="text-paper/55">{handle ? `@${handle}` : "your portfolio"}</Eyebrow>
          {streak && streak.current_days > 0 ? (
            <StreakFlame currentDays={streak.current_days} longestDays={streak.longest_days} />
          ) : null}
        </div>
        <div className="mt-2">
          <BalanceNumeral value={total} size="lg" softDecimal className="block text-paper" />
        </div>
        <Eyebrow rule className={cn("mt-4", pctClass)}>
          {pctText}
        </Eyebrow>
      </div>
    </Card>
  );
}
```

- [ ] **Step 6.3: TypeScript check on the web app**

```bash
pnpm --filter @paper/web tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6.4: Run Playwright E2E smoke test**

```bash
# Start the dev server in a separate terminal first:
# pnpm --filter @paper/web dev
pnpm --filter @paper/web playwright test --grep "dashboard"
```

Expected: existing dashboard tests still pass. If no `dashboard` grep match, run:

```bash
pnpm --filter @paper/web playwright test
```

And confirm no regressions.

- [ ] **Step 6.5: Commit**

```bash
git add apps/web/src/components/dashboard/StreakFlame.tsx \
        apps/web/src/components/dashboard/HeroPortfolioCard.tsx
git commit -m "feat(web): StreakFlame component + HeroPortfolioCard integration"
```

---

### Task 7: Lab manifest — K8s CronJob for streak reaper

**Files:**
- Create: `/Users/filipkastovsky/work/personal/lab/stacks/paper/manifests/41-cron-streak-reaper.yaml`

- [ ] **Step 7.1: Create the CronJob manifest**

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: paper-cron-streak-reaper
  namespace: paper
spec:
  schedule: "0 * * * *"
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
            - name: cron-streak-reaper
              image: ${image}
              command: ["node", "apps/server/dist/jobs/streak-reaper.js"]
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
                  value: paper-cron-streak-reaper
              resources:
                requests: { cpu: "10m", memory: "64Mi" }
                limits:   { cpu: "100m", memory: "128Mi" }
```

- [ ] **Step 7.2: Confirm the manifest is alongside the existing daily-snapshot CronJob**

```bash
ls /Users/filipkastovsky/work/personal/lab/stacks/paper/manifests/ | sort
# Expected: 40-cron-daily-snapshot.yaml and 41-cron-streak-reaper.yaml both present
```

- [ ] **Step 7.3: Commit in the lab repo**

```bash
cd /Users/filipkastovsky/work/personal/lab
git add stacks/paper/manifests/41-cron-streak-reaper.yaml
git commit -m "feat(paper): add streak-reaper CronJob (hourly)"
```

---

### Task 8: Deploy

- [ ] **Step 8.1: Build and push the arm64 server image**

```bash
cd /Users/filipkastovsky/work/personal/startup
# Build arm64 image (podman, not docker)
podman build --platform linux/arm64 -t ghcr.io/<org>/paper-server:plan-5 -f apps/server/Dockerfile .
podman push ghcr.io/<org>/paper-server:plan-5
```

- [ ] **Step 8.2: Apply the new CronJob manifest via Terragrunt**

```bash
cd /Users/filipkastovsky/work/personal/lab
# Substitute the image tag in the manifest and apply
IMAGE=ghcr.io/<org>/paper-server:plan-5 \
  envsubst < stacks/paper/manifests/41-cron-streak-reaper.yaml | kubectl apply -f -
```

Or, if Terragrunt manages the manifest directory:

```bash
cd /Users/filipkastovsky/work/personal/lab/stacks/paper
terragrunt apply
```

- [ ] **Step 8.3: Run the Drizzle migration against production**

```bash
# From inside the cluster or using kubectl exec on the paper-api pod
kubectl -n paper exec deploy/paper-api -- node apps/server/dist/migrate.js
# Or via the paper-migrate Job pattern used in previous plans
```

- [ ] **Step 8.4: Verify the CronJob is registered**

```bash
kubectl -n paper get cronjobs
# Expected: paper-cron-streak-reaper listed with schedule "0 * * * *"
```

- [ ] **Step 8.5: Verify the streak reaper runs manually**

```bash
kubectl -n paper create job --from=cronjob/paper-cron-streak-reaper streak-reaper-manual-test
kubectl -n paper logs job/streak-reaper-manual-test
# Expected JSON log: {"event":"streak_reaper_done","reaped":0,"elapsed_ms":<N>}
```

- [ ] **Step 8.6: Deploy the web app**

```bash
cd /Users/filipkastovsky/work/personal/startup
pnpm --filter @paper/web build
wrangler deploy --env production
```

- [ ] **Step 8.7: Smoke test on production**

Open https://papercrypto.tech on an iPhone (or DevTools mobile emulation). Complete a lesson or execute a trade. Reload the dashboard. Confirm the flame icon `🔥 1` appears in the top-right of the Hero Portfolio Card. Tap it — confirm the BottomSheet shows "1 day streak" and "1 longest".

---

## Self-Review Checklist

### Spec Coverage

| Spec item | Covered |
|-----------|---------|
| `streaks` table with all 5 columns | T1 Step 1.1 |
| Migration generated and applied | T1 Steps 1.3–1.4 |
| `truncateAllTables` updated | T1 Step 1.5 |
| `upsertStreak` — same-day no-op | T2 service + T2 test Step 2.1 |
| `upsertStreak` — yesterday extends | T2 service + T2 test Step 2.1 |
| `upsertStreak` — older resets to 1 | T2 service + T2 test Step 2.1 |
| `upsertStreak` — longestDays updated | T2 service + T2 test Step 2.1 |
| `reapExpiredStreaks` — sets currentDays=0 where stale | T2 service + T2 test Step 2.1 |
| `reapExpiredStreaks` — skips recent rows | T2 test Step 2.1 |
| `reapExpiredStreaks` — skips already-zero rows | T2 test Step 2.1 |
| Wire streak into `POST /v1/trades` non-blocking | T3 Step 3.4 |
| Wire streak into `POST /v1/lessons/:id/complete` non-blocking | T3 Step 3.5 |
| `GET /v1/me` returns `streak: null` when no row | T3 Steps 3.1 + 3.3 |
| `GET /v1/me` returns streak data after qualifying action | T3 Steps 3.1 + 3.3 |
| `streak-reaper.ts` job file | T4 |
| Kubb codegen regenerated | T5 |
| `StreakFlame` component (button + BottomSheet) | T6 Step 6.1 |
| `HeroPortfolioCard` shows flame only when `current_days > 0` | T6 Step 6.2 |
| K8s CronJob manifest (hourly schedule) | T7 |

### Placeholder Scan

No step uses "implement X" without showing code. All bash commands have expected outputs documented.

### Type Consistency

- Drizzle schema uses `integer` (not `smallint`) for streak day counts — consistent with no upper bound concern.
- `getStreak` returns `Streak | null` (inferred from Drizzle's `$inferSelect`), not a custom type — avoids double-typing.
- Wire shape in `GET /v1/me` uses `snake_case` keys (`current_days`, `longest_days`, `perfect_days_count`) consistent with all other API wire types in `me.ts`.
- `StreakFlame` props use `camelCase` (`currentDays`, `longestDays`) — consistent with React conventions in the existing codebase.
- `void upsertStreak(...).catch(...)` pattern is identical in both routes — consistent non-blocking fire-and-forget without unhandled-rejection risk.
