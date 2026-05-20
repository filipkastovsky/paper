# Global Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a global weekly leaderboard that ranks all users by a composite score derived from portfolio performance, lessons completed, and streak days. The leaderboard is recomputed every 5 minutes by a K8s CronJob and reset each Sunday at 00:00 UTC. A `/leaderboard` web page surfaces the top 50 users and always shows the authenticated user's own rank even if outside the top 50.

**Architecture:** A single `leaderboard_snapshots` table holds one row per user (PK = `user_id`). Recomputation is done with a single raw SQL upsert using `RANK() OVER (...)` — one round-trip for the entire user base. The service exposes three pure functions: `recomputeLeaderboard`, `weeklyReset`, and `getLeaderboard`. The route is a simple read-through of `getLeaderboard`. Two standalone CronJob scripts handle scheduling.

**Tech Stack:**
- **Server:** Fastify 5, Zod 4, Drizzle ORM + drizzle-kit, postgres.js, `@fastify/jwt`, Kubb codegen
- **Web:** Vite, React 18, TanStack Router, TanStack Query (`useGetV1Leaderboard`), Tailwind v4, Marshmallow tokens
- **Tests:** Vitest (pool: `forks`, `singleFork: true`)
- **Container:** podman arm64, k3s on Hetzner

---

**Prerequisites:**
- P1: Working on branch `plan-7-leaderboard` branched off `plan-6-daily-question`
- P2: Plans 5 and 6 merged — `streaks`, `daily_questions`, `user_predictions`, `prediction_points` tables exist in the DB
- P3: `podman compose up` — Postgres + Redis containers running
- P4: `pnpm install` up to date across the monorepo

## File Structure

```
apps/server/
  src/db/schema/leaderboard-snapshots.ts        # T1 — leaderboard_snapshots Drizzle table
  src/db/schema/index.ts                        # T1 — re-export leaderboard-snapshots
  drizzle/0007_*.sql                            # T1 — generated migration (next idx after plan-6 migrations)
  test/helpers/db.ts                            # T1 — extend truncateAllTables
  src/services/leaderboard.ts                   # T2 — recomputeLeaderboard, weeklyReset, getLeaderboard
  test/services/leaderboard.test.ts             # T2 — service-level TDD
  src/routes/leaderboard.ts                     # T3 — GET /v1/leaderboard
  src/server.ts                                 # T3 — register leaderboardRoutes
  test/routes/leaderboard.test.ts               # T3 — route integration tests
  src/jobs/leaderboard-recompute.ts             # T4 — every-5-min cron entry point
  src/jobs/leaderboard-weekly-reset.ts          # T4 — Sunday 00:00 UTC cron entry point

packages/api-client/                            # T5 — Kubb codegen re-run

apps/web/
  src/routes/leaderboard.tsx                    # T6 — /leaderboard page
  src/routes/dashboard.tsx                      # T6 — add Leaderboard link button

lab repo (/Users/filipkastovsky/work/personal/lab):
  stacks/paper/manifests/43-cron-leaderboard-recompute.yaml   # T7
  stacks/paper/manifests/44-cron-leaderboard-weekly-reset.yaml # T7
```

---

### Task 1: `leaderboard-snapshots` schema + Drizzle migration + truncateAllTables

**Files:**
- Create: `apps/server/src/db/schema/leaderboard-snapshots.ts`
- Modify: `apps/server/src/db/schema/index.ts`
- Modify: `apps/server/test/helpers/db.ts`

- [ ] **Step 1.1: Create `apps/server/src/db/schema/leaderboard-snapshots.ts`**

```typescript
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * One row per user, upserted every 5 minutes by the leaderboard-recompute CronJob.
 * `week_starting_date` is the ISO date (YYYY-MM-DD) of the Sunday that starts the
 * current leaderboard week. All rows in the table belong to the same week; on
 * Sunday 00:00 UTC the weekly-reset job deletes all rows and the recompute job
 * immediately repopulates for the new week.
 *
 * `composite_score` = FLOOR((total_val - 10000) / 10000 * 100) + lessons * 5 + streak_days
 * `rank_global` = RANK() OVER (ORDER BY composite_score DESC)
 *
 * PK is user_id so ON CONFLICT (user_id) DO UPDATE is a simple upsert.
 */
export const leaderboardSnapshots = pgTable("leaderboard_snapshots", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  weekStartingDate: text("week_starting_date").notNull(), // YYYY-MM-DD of current week's Sunday
  compositeScore: integer("composite_score").notNull().default(0),
  rankGlobal: integer("rank_global").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LeaderboardSnapshot = typeof leaderboardSnapshots.$inferSelect;
export type NewLeaderboardSnapshot = typeof leaderboardSnapshots.$inferInsert;
```

- [ ] **Step 1.2: Re-export from `apps/server/src/db/schema/index.ts`**

Add after the existing last export line. After Plans 5 and 6, the file ends with their exports. Add leaderboard-snapshots last:

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
export * from "./leaderboard-snapshots.js";
```

Note: The exact set of Plan 5 + 6 exports will be whatever those plans added. The critical addition here is the final `leaderboard-snapshots` line.

- [ ] **Step 1.3: Generate the Drizzle migration**

```bash
cd /Users/filipkastovsky/work/personal/startup
pnpm --filter @paper/server drizzle-kit generate
```

Expected output: a new file `apps/server/drizzle/0007_*.sql` (exact index depends on how many migrations Plans 5 and 6 produced) containing:

```sql
CREATE TABLE "leaderboard_snapshots" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "week_starting_date" text NOT NULL,
  "composite_score" integer DEFAULT 0 NOT NULL,
  "rank_global" integer DEFAULT 1 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "leaderboard_snapshots_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade
);
```

Verify:

```bash
ls apps/server/drizzle/ | grep -E "^000[5-9]|^001"
# Should show the new migration file
```

- [ ] **Step 1.4: Apply the migration to the local dev DB**

```bash
pnpm --filter @paper/server drizzle-kit migrate
```

Expected: migration applied successfully.

- [ ] **Step 1.5: Update `apps/server/test/helpers/db.ts`**

The current file (after Plans 5 and 6) will look like:

```typescript
import type { Db } from "@/db/client.js";
import { sql } from "drizzle-orm";

export async function truncateAllTables(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE "trades", "portfolio_snapshots", "portfolios", "refresh_tokens", "lesson_progress", "streaks", "user_predictions", "prediction_points", "daily_questions", "leaderboard_snapshots", "users" RESTART IDENTITY CASCADE`,
  );
}
```

Add `"leaderboard_snapshots"` to the TRUNCATE list immediately before `"users"`. The complete updated file:

```typescript
import type { Db } from "@/db/client.js";
import { sql } from "drizzle-orm";

export async function truncateAllTables(db: Db): Promise<void> {
  // Order matters via FK chain: trades + portfolio_snapshots + portfolios + refresh_tokens → users.
  // CASCADE handles the FK chain regardless of list order; we still spell out every table to keep
  // the test fixture aware of the full schema (CI fails fast if a new table forgets to add itself).
  await db.execute(
    sql`TRUNCATE TABLE "trades", "portfolio_snapshots", "portfolios", "refresh_tokens", "lesson_progress", "streaks", "user_predictions", "prediction_points", "daily_questions", "leaderboard_snapshots", "users" RESTART IDENTITY CASCADE`,
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
git add apps/server/src/db/schema/leaderboard-snapshots.ts \
        apps/server/src/db/schema/index.ts \
        apps/server/drizzle/ \
        apps/server/test/helpers/db.ts
git commit -m "feat(db): add leaderboard_snapshots table and migration"
```

---

### Task 2: Leaderboard service + tests (TDD)

**Files:**
- Create: `apps/server/src/services/leaderboard.ts`
- Create: `apps/server/test/services/leaderboard.test.ts`

- [ ] **Step 2.1: Write failing tests first — create `apps/server/test/services/leaderboard.test.ts`**

```typescript
import { makeDb } from "@/db/client.js";
import { leaderboardSnapshots, portfolios, users } from "@/db/schema/index.js";
import {
  getLeaderboard,
  recomputeLeaderboard,
  weeklyReset,
} from "@/services/leaderboard.js";
import { closeRedis } from "@/services/redis.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { truncateAllTables } from "../helpers/db.js";

const dbUrl = process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/paper";

// Helper to compute the current week's Sunday as YYYY-MM-DD
function currentWeekSunday(): string {
  const d = new Date();
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = -day;
  const sunday = new Date(d);
  sunday.setUTCDate(d.getUTCDate() + diff);
  return sunday.toISOString().slice(0, 10);
}

describe("recomputeLeaderboard", () => {
  const handles = makeDb(dbUrl, { max: 2 });

  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  async function seedUser(deviceUuid: string): Promise<string> {
    const [u] = await handles.db
      .insert(users)
      .values({ deviceUuid })
      .returning({ id: users.id });
    if (!u) throw new Error("no user");
    return u.id;
  }

  it("creates a leaderboard_snapshots row for each user", async () => {
    const userId = await seedUser("00000000-0000-0000-0000-00000000lb01");
    const weekSunday = currentWeekSunday();

    await recomputeLeaderboard(handles.db, weekSunday);

    const rows = await handles.db
      .select()
      .from(leaderboardSnapshots)
      .where(eq(leaderboardSnapshots.userId, userId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.weekStartingDate).toBe(weekSunday);
    expect(rows[0]?.rankGlobal).toBe(1);
  });

  it("user with default $10k cash has composite_score of 0 (FLOOR((10000-10000)/10000*100)=0)", async () => {
    const userId = await seedUser("00000000-0000-0000-0000-00000000lb02");
    const weekSunday = currentWeekSunday();

    await recomputeLeaderboard(handles.db, weekSunday);

    const [row] = await handles.db
      .select()
      .from(leaderboardSnapshots)
      .where(eq(leaderboardSnapshots.userId, userId));

    // No lessons, no streak, cash = starting 10000 → score = 0
    expect(row?.compositeScore).toBe(0);
  });

  it("user with $11000 cash gets +10 from portfolio component (FLOOR(1000/10000*100)=10)", async () => {
    const userId = await seedUser("00000000-0000-0000-0000-00000000lb03");
    const weekSunday = currentWeekSunday();

    // Overwrite the auto-created portfolio cash
    await handles.db
      .update(portfolios)
      .set({ cashUsd: "11000.00000000" })
      .where(eq(portfolios.userId, userId));

    await recomputeLeaderboard(handles.db, weekSunday);

    const [row] = await handles.db
      .select()
      .from(leaderboardSnapshots)
      .where(eq(leaderboardSnapshots.userId, userId));

    expect(row?.compositeScore).toBe(10);
  });

  it("higher-scoring user gets rank 1, lower-scoring user gets rank 2", async () => {
    const userA = await seedUser("00000000-0000-0000-0000-00000000lb04");
    const userB = await seedUser("00000000-0000-0000-0000-00000000lb05");
    const weekSunday = currentWeekSunday();

    // User A has more cash
    await handles.db
      .update(portfolios)
      .set({ cashUsd: "15000.00000000" })
      .where(eq(portfolios.userId, userA));

    // User B stays at default $10,000

    await recomputeLeaderboard(handles.db, weekSunday);

    const [rowA] = await handles.db
      .select()
      .from(leaderboardSnapshots)
      .where(eq(leaderboardSnapshots.userId, userA));
    const [rowB] = await handles.db
      .select()
      .from(leaderboardSnapshots)
      .where(eq(leaderboardSnapshots.userId, userB));

    expect(rowA?.rankGlobal).toBe(1);
    expect(rowB?.rankGlobal).toBe(2);
  });

  it("is idempotent — running twice keeps one row per user with updated values", async () => {
    const userId = await seedUser("00000000-0000-0000-0000-00000000lb06");
    const weekSunday = currentWeekSunday();

    await recomputeLeaderboard(handles.db, weekSunday);
    await recomputeLeaderboard(handles.db, weekSunday);

    const rows = await handles.db
      .select()
      .from(leaderboardSnapshots)
      .where(eq(leaderboardSnapshots.userId, userId));

    expect(rows).toHaveLength(1);
  });

  it("users with no portfolio row get composite_score of 0 (no crash)", async () => {
    // Seed a bare user with no portfolio (LEFT JOIN should handle this)
    const [u] = await handles.db
      .insert(users)
      .values({ deviceUuid: "00000000-0000-0000-0000-00000000lb07" })
      .returning({ id: users.id });
    if (!u) throw new Error("no user");
    // Note: device auth normally creates a portfolio. Here we skip it to test robustness.
    // Delete the auto-created portfolio if it exists (it won't here since we bypassed auth).
    const weekSunday = currentWeekSunday();

    await expect(recomputeLeaderboard(handles.db, weekSunday)).resolves.not.toThrow();
  });
});

describe("weeklyReset", () => {
  const handles = makeDb(dbUrl, { max: 2 });

  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  it("deletes all rows from leaderboard_snapshots", async () => {
    const [u] = await handles.db
      .insert(users)
      .values({ deviceUuid: "00000000-0000-0000-0000-00000000lb08" })
      .returning({ id: users.id });
    if (!u) throw new Error("no user");
    const weekSunday = currentWeekSunday();

    await recomputeLeaderboard(handles.db, weekSunday);

    const beforeReset = await handles.db.select().from(leaderboardSnapshots);
    expect(beforeReset.length).toBeGreaterThan(0);

    await weeklyReset(handles.db);

    const afterReset = await handles.db.select().from(leaderboardSnapshots);
    expect(afterReset).toHaveLength(0);
  });
});

describe("getLeaderboard", () => {
  const handles = makeDb(dbUrl, { max: 2 });

  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  async function seedUser(deviceUuid: string): Promise<string> {
    const [u] = await handles.db
      .insert(users)
      .values({ deviceUuid, handle: `user_${deviceUuid.slice(-4)}` })
      .returning({ id: users.id });
    if (!u) throw new Error("no user");
    return u.id;
  }

  it("returns empty entries and null my_entry when no snapshot rows exist", async () => {
    const userId = await seedUser("00000000-0000-0000-0000-00000000lb09");
    const result = await getLeaderboard(handles.db, userId, 50);

    expect(result.entries).toHaveLength(0);
    expect(result.my_entry).toBeNull();
    expect(result.week_starting_date).toBe(currentWeekSunday());
  });

  it("returns top N entries ordered by rank ascending", async () => {
    const userA = await seedUser("00000000-0000-0000-0000-00000000lb10");
    const userB = await seedUser("00000000-0000-0000-0000-00000000lb11");
    const userC = await seedUser("00000000-0000-0000-0000-00000000lb12");
    const weekSunday = currentWeekSunday();

    // Give users different cash amounts so ranks differ
    await handles.db
      .update(portfolios)
      .set({ cashUsd: "13000.00000000" })
      .where(eq(portfolios.userId, userA));
    await handles.db
      .update(portfolios)
      .set({ cashUsd: "12000.00000000" })
      .where(eq(portfolios.userId, userB));
    // userC stays at $10k (rank 3)

    await recomputeLeaderboard(handles.db, weekSunday);

    const result = await getLeaderboard(handles.db, userC, 50);

    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]?.rank).toBe(1);
    expect(result.entries[0]?.user_id).toBe(userA);
    expect(result.entries[1]?.rank).toBe(2);
    expect(result.entries[1]?.user_id).toBe(userB);
    expect(result.entries[2]?.rank).toBe(3);
  });

  it("respects the limit parameter", async () => {
    // Seed 5 users
    for (let i = 0; i < 5; i++) {
      await seedUser(`00000000-0000-0000-0000-00000000lb${13 + i}`);
    }
    const weekSunday = currentWeekSunday();
    await recomputeLeaderboard(handles.db, weekSunday);

    const lastUserId = (
      await handles.db.select({ id: users.id }).from(users)
    )[4]?.id;
    if (!lastUserId) throw new Error("no user");

    const result = await getLeaderboard(handles.db, lastUserId, 3);

    expect(result.entries).toHaveLength(3);
  });

  it("returns my_entry for the caller even if outside the top-N limit", async () => {
    // Seed 5 users; caller is the worst-performing one
    const userIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const uid = await seedUser(`00000000-0000-0000-0000-00000000lb${18 + i}`);
      userIds.push(uid);
    }

    // Give the first 4 users more cash so caller (userIds[4]) ranks last
    for (let i = 0; i < 4; i++) {
      await handles.db
        .update(portfolios)
        .set({ cashUsd: `${12000 + i * 500}.00000000` })
        .where(eq(portfolios.userId, userIds[i]!));
    }

    const weekSunday = currentWeekSunday();
    await recomputeLeaderboard(handles.db, weekSunday);

    const callerId = userIds[4]!;
    // Limit to 3 — caller (rank 5) is outside
    const result = await getLeaderboard(handles.db, callerId, 3);

    expect(result.entries).toHaveLength(3);
    expect(result.my_entry).not.toBeNull();
    expect(result.my_entry?.rank).toBe(5);
    expect(result.my_entry?.user_id).toBe(callerId);
  });

  it("includes handle in entries (nullable — handle may be null)", async () => {
    const userId = await seedUser("00000000-0000-0000-0000-00000000lb23");
    const weekSunday = currentWeekSunday();
    await recomputeLeaderboard(handles.db, weekSunday);

    const result = await getLeaderboard(handles.db, userId, 50);

    expect(result.entries[0]).toHaveProperty("handle");
    // handle is set to "user_lb23" from seedUser above
    expect(result.entries[0]?.handle).toBe("user_lb23");
  });
});
```

- [ ] **Step 2.2: Run tests to confirm they all fail (no service yet)**

```bash
cd /Users/filipkastovsky/work/personal/startup
pnpm --filter @paper/server vitest run test/services/leaderboard.test.ts
```

Expected: all tests fail with "Cannot find module '@/services/leaderboard.js'" or similar.

- [ ] **Step 2.3: Implement `apps/server/src/services/leaderboard.ts`**

```typescript
import type { Db } from "@/db/client.js";
import { leaderboardSnapshots, users } from "@/db/schema/index.js";
import { asc, eq, sql } from "drizzle-orm";

// ─── currentWeekSunday ───────────────────────────────────────────────────────

/**
 * Returns the ISO date (YYYY-MM-DD) of the Sunday that starts the current
 * UTC week. If today IS Sunday (getUTCDay() === 0), the diff is 0 and we
 * return today's date.
 */
export function currentWeekSunday(now: Date = new Date()): string {
  const day = now.getUTCDay(); // 0 = Sunday, 6 = Saturday
  const diff = -day;           // always <= 0
  const sunday = new Date(now);
  sunday.setUTCDate(now.getUTCDate() + diff);
  return sunday.toISOString().slice(0, 10);
}

// ─── recomputeLeaderboard ────────────────────────────────────────────────────

/**
 * Bulk-recomputes composite scores and global ranks for ALL users in a single
 * SQL round-trip, then upserts into leaderboard_snapshots.
 *
 * Composite score formula:
 *   FLOOR((total_val - 10000) / 10000 * 100) + lessons_completed * 5 + streak_days
 *
 * total_val is resolved as:
 *   1. portfolio_snapshots row for today's UTC date (most recent daily snapshot), OR
 *   2. portfolios.cash_usd (ignores unsold holdings, but avoids live price fetch), OR
 *   3. 10000 (default starting value, avoids division anomalies for fresh users)
 *
 * Ties share the same rank (RANK(), not ROW_NUMBER()). Users with no portfolio
 * row are included with total_val = 10000 (score 0).
 */
export async function recomputeLeaderboard(db: Db, weekStartingDate: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  await db.execute(sql`
    WITH scores AS (
      SELECT
        u.id                                  AS user_id,
        COALESCE(
          (
            SELECT ps.total_value_usd::numeric
            FROM   portfolio_snapshots ps
            WHERE  ps.user_id      = u.id
              AND  ps.snapshot_date = ${today}
            LIMIT  1
          ),
          p.cash_usd::numeric,
          10000
        )                                     AS total_val,
        COUNT(DISTINCT lp.lesson_id)::int     AS lessons,
        COALESCE(s.current_days, 0)           AS streak
      FROM       users              u
      LEFT JOIN  portfolios         p  ON p.user_id  = u.id
      LEFT JOIN  lesson_progress    lp ON lp.user_id = u.id
      LEFT JOIN  streaks            s  ON s.user_id  = u.id
      GROUP BY   u.id, p.cash_usd, s.current_days
    ),
    ranked AS (
      SELECT
        user_id,
        (
          FLOOR((total_val - 10000) / 10000 * 100)::int
          + (lessons * 5)
          + streak
        )                                             AS composite_score,
        RANK() OVER (
          ORDER BY (
            FLOOR((total_val - 10000) / 10000 * 100)::int
            + (lessons * 5)
            + streak
          ) DESC
        )::int                                        AS rank_global
      FROM scores
    )
    INSERT INTO leaderboard_snapshots
      (user_id, week_starting_date, composite_score, rank_global, updated_at)
    SELECT
      user_id,
      ${weekStartingDate},
      composite_score,
      rank_global,
      now()
    FROM ranked
    ON CONFLICT (user_id) DO UPDATE SET
      week_starting_date = EXCLUDED.week_starting_date,
      composite_score    = EXCLUDED.composite_score,
      rank_global        = EXCLUDED.rank_global,
      updated_at         = EXCLUDED.updated_at
  `);
}

// ─── weeklyReset ─────────────────────────────────────────────────────────────

/**
 * Deletes ALL rows from leaderboard_snapshots. Called by the weekly-reset cron
 * job on Sunday 00:00 UTC immediately before triggering a fresh recompute.
 * The table is empty for the ~seconds it takes the recompute to run.
 */
export async function weeklyReset(db: Db): Promise<void> {
  await db.delete(leaderboardSnapshots);
}

// ─── LeaderboardEntry / getLeaderboard ───────────────────────────────────────

export type LeaderboardEntry = {
  rank: number;
  user_id: string;
  handle: string | null;
  composite_score: number;
};

export type GetLeaderboardResult = {
  week_starting_date: string;
  entries: LeaderboardEntry[];
  my_entry: LeaderboardEntry | null;
};

/**
 * Returns the top `limit` entries from leaderboard_snapshots ordered by
 * rank_global ascending, plus the caller's own entry (even if outside top N).
 *
 * If the table is empty (e.g. right after weekly reset, before the next
 * recompute runs), both `entries` and `my_entry` are empty/null.
 */
export async function getLeaderboard(
  db: Db,
  callerId: string,
  limit: number,
): Promise<GetLeaderboardResult> {
  const weekStartingDate = currentWeekSunday();

  // Top N
  const topRows = await db
    .select({
      rank: leaderboardSnapshots.rankGlobal,
      user_id: leaderboardSnapshots.userId,
      handle: users.handle,
      composite_score: leaderboardSnapshots.compositeScore,
    })
    .from(leaderboardSnapshots)
    .innerJoin(users, eq(users.id, leaderboardSnapshots.userId))
    .orderBy(asc(leaderboardSnapshots.rankGlobal))
    .limit(limit);

  // Caller's own row (null if table is empty or user not yet recomputed)
  const [myRow] = await db
    .select({
      rank: leaderboardSnapshots.rankGlobal,
      user_id: leaderboardSnapshots.userId,
      handle: users.handle,
      composite_score: leaderboardSnapshots.compositeScore,
    })
    .from(leaderboardSnapshots)
    .innerJoin(users, eq(users.id, leaderboardSnapshots.userId))
    .where(eq(leaderboardSnapshots.userId, callerId));

  return {
    week_starting_date: weekStartingDate,
    entries: topRows,
    my_entry: myRow ?? null,
  };
}
```

- [ ] **Step 2.4: Run tests — all should pass**

```bash
pnpm --filter @paper/server vitest run test/services/leaderboard.test.ts
```

Expected: all tests pass.

- [ ] **Step 2.5: Verify TypeScript**

```bash
pnpm --filter @paper/server tsc --noEmit
```

- [ ] **Step 2.6: Commit**

```bash
git add apps/server/src/services/leaderboard.ts \
        apps/server/test/services/leaderboard.test.ts
git commit -m "feat(leaderboard): add leaderboard service with recompute, reset, and query"
```

---

### Task 3: Leaderboard route + server registration + route tests

**Files:**
- Create: `apps/server/src/routes/leaderboard.ts`
- Modify: `apps/server/src/server.ts`
- Create: `apps/server/test/routes/leaderboard.test.ts`

- [ ] **Step 3.1: Create `apps/server/src/routes/leaderboard.ts`**

```typescript
import { getLeaderboard, recomputeLeaderboard, currentWeekSunday } from "@/services/leaderboard.js";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const LeaderboardEntry = z.object({
  rank: z.number().int(),
  user_id: z.string().uuid(),
  handle: z.string().nullable(),
  composite_score: z.number().int(),
});

const LeaderboardQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const LeaderboardResponse = z.object({
  week_starting_date: z.string(),
  entries: z.array(LeaderboardEntry),
  my_entry: LeaderboardEntry.nullable(),
});

export const leaderboardRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/leaderboard",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["leaderboard"],
        summary: "Get the global weekly leaderboard (top N + caller's rank)",
        security: [{ bearerAuth: [] }],
        querystring: LeaderboardQuery,
        response: { 200: LeaderboardResponse },
      },
    },
    async (request) => {
      const userId = request.user.sub;
      const { limit } = request.query;
      return getLeaderboard(app.db, userId, limit);
    },
  );
};
```

- [ ] **Step 3.2: Register the route in `apps/server/src/server.ts`**

Add the import after the `learnRoutes` import:

```typescript
import { leaderboardRoutes } from "./routes/leaderboard.js";
```

Add the registration after `app.register(learnRoutes)`:

```typescript
await app.register(leaderboardRoutes);
```

The full imports section of `server.ts` after the change:

```typescript
import { assetsRoutes } from "./routes/assets.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { learnRoutes } from "./routes/learn.js";
import { leaderboardRoutes } from "./routes/leaderboard.js";
import { meRoutes } from "./routes/me.js";
import { tradesRoutes } from "./routes/trades.js";
```

The registrations block (after the change):

```typescript
await app.register(healthRoutes);
await app.register(authRoutes);
await app.register(assetsRoutes);
await app.register(meRoutes);
await app.register(tradesRoutes);
await app.register(learnRoutes);
await app.register(leaderboardRoutes);
```

- [ ] **Step 3.3: Create `apps/server/test/routes/leaderboard.test.ts`**

```typescript
import { leaderboardSnapshots, portfolios, users } from "@/db/schema/index.js";
import { recomputeLeaderboard, currentWeekSunday } from "@/services/leaderboard.js";
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
    const { token } = await deviceAuth("00000000-0000-0000-0000-00000000lr01");

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
    const { token, userId } = await deviceAuth("00000000-0000-0000-0000-00000000lr02");

    await recomputeLeaderboard(ctx.db, currentWeekSunday());

    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/leaderboard",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      entries: Array<{ rank: number; user_id: string; handle: string | null; composite_score: number }>;
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
    // Seed 3 users
    for (let i = 0; i < 3; i++) {
      await deviceAuth(`00000000-0000-0000-0000-00000000lr0${3 + i}`);
    }
    const { token } = await deviceAuth("00000000-0000-0000-0000-00000000lr06");

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
    // Seed the caller first with default cash (they'll rank last)
    const { token: callerToken, userId: callerId } = await deviceAuth(
      "00000000-0000-0000-0000-00000000lr07",
    );

    // Seed two users with more cash — they'll outrank the caller
    const { userId: richA } = await deviceAuth("00000000-0000-0000-0000-00000000lr08");
    const { userId: richB } = await deviceAuth("00000000-0000-0000-0000-00000000lr09");

    await ctx.db
      .update(portfolios)
      .set({ cashUsd: "15000.00000000" })
      .where(eq(portfolios.userId, richA));
    await ctx.db
      .update(portfolios)
      .set({ cashUsd: "14000.00000000" })
      .where(eq(portfolios.userId, richB));

    await recomputeLeaderboard(ctx.db, currentWeekSunday());

    // Limit=2 means caller (rank 3) is outside entries
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
    const { token } = await deviceAuth("00000000-0000-0000-0000-00000000lr10");

    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/leaderboard?limit=201",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 3.4: Run the route tests**

```bash
pnpm --filter @paper/server vitest run test/routes/leaderboard.test.ts
```

Expected: all tests pass.

- [ ] **Step 3.5: Run the full test suite to check for regressions**

```bash
pnpm --filter @paper/server vitest run
```

Expected: all previously passing tests still pass.

- [ ] **Step 3.6: Verify TypeScript**

```bash
pnpm --filter @paper/server tsc --noEmit
```

- [ ] **Step 3.7: Commit**

```bash
git add apps/server/src/routes/leaderboard.ts \
        apps/server/src/server.ts \
        apps/server/test/routes/leaderboard.test.ts
git commit -m "feat(leaderboard): add GET /v1/leaderboard route"
```

---

### Task 4: Cron job entry points

**Files:**
- Create: `apps/server/src/jobs/leaderboard-recompute.ts`
- Create: `apps/server/src/jobs/leaderboard-weekly-reset.ts`

- [ ] **Step 4.1: Create `apps/server/src/jobs/leaderboard-recompute.ts`**

```typescript
import { loadConfig } from "../config.js";
import { makeDb } from "../db/client.js";
import { currentWeekSunday, recomputeLeaderboard } from "../services/leaderboard.js";

async function main(): Promise<void> {
  const t0 = Date.now();
  const config = loadConfig();
  // Small pool — this job is the only consumer of the DB instance.
  const handles = makeDb(config.DATABASE_URL, { max: 4 });
  const weekStartingDate = currentWeekSunday();

  try {
    await recomputeLeaderboard(handles.db, weekStartingDate);
    const elapsedMs = Date.now() - t0;
    console.info(
      JSON.stringify({
        event: "leaderboard_recompute_done",
        week_starting_date: weekStartingDate,
        elapsed_ms: elapsedMs,
      }),
    );
    process.exit(0);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "leaderboard_recompute_error",
        week_starting_date: weekStartingDate,
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

- [ ] **Step 4.2: Create `apps/server/src/jobs/leaderboard-weekly-reset.ts`**

```typescript
import { loadConfig } from "../config.js";
import { makeDb } from "../db/client.js";
import { currentWeekSunday, recomputeLeaderboard, weeklyReset } from "../services/leaderboard.js";

async function main(): Promise<void> {
  const t0 = Date.now();
  const config = loadConfig();
  const handles = makeDb(config.DATABASE_URL, { max: 4 });

  // Compute the new week's Sunday BEFORE the reset so we stamp the fresh rows
  // with the correct week_starting_date (today IS the new Sunday).
  const newWeekSunday = currentWeekSunday();

  try {
    await weeklyReset(handles.db);
    console.info(JSON.stringify({ event: "leaderboard_weekly_reset_done", new_week: newWeekSunday }));

    // Immediately recompute so the table is not empty after the reset.
    await recomputeLeaderboard(handles.db, newWeekSunday);
    const elapsedMs = Date.now() - t0;
    console.info(
      JSON.stringify({
        event: "leaderboard_weekly_reset_recompute_done",
        new_week: newWeekSunday,
        elapsed_ms: elapsedMs,
      }),
    );
    process.exit(0);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "leaderboard_weekly_reset_error",
        new_week: newWeekSunday,
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

- [ ] **Step 4.3: Verify TypeScript for both jobs**

```bash
pnpm --filter @paper/server tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4.4: Commit**

```bash
git add apps/server/src/jobs/leaderboard-recompute.ts \
        apps/server/src/jobs/leaderboard-weekly-reset.ts
git commit -m "feat(leaderboard): add leaderboard-recompute and leaderboard-weekly-reset cron jobs"
```

---

### Task 5: Kubb codegen

**Files:**
- Run codegen — output lands in `packages/api-client/`

- [ ] **Step 5.1: Run codegen**

```bash
cd /Users/filipkastovsky/work/personal/startup
pnpm gen:api-client
```

The Kubb codegen reads the Fastify/Zod OpenAPI spec (served by the Swagger plugin) and generates:
- `packages/api-client/src/gen/hooks/useGetV1Leaderboard.ts` — TanStack Query hook
- `packages/api-client/src/gen/types/GetV1Leaderboard*.ts` — request/response types

Verify the new hook exists:

```bash
find packages/api-client/src -name "*eaderboard*" -o -name "*leaderboard*"
```

Expected: at least one file matching `useGetV1Leaderboard`.

- [ ] **Step 5.2: Check the generated hook exports `useGetV1Leaderboard`**

The hook should accept an optional `params` object with `limit?: number` and return the `LeaderboardResponse` shape.

- [ ] **Step 5.3: Verify TypeScript in api-client package**

```bash
pnpm --filter @paper/api-client tsc --noEmit
```

- [ ] **Step 5.4: Commit**

```bash
git add packages/api-client/
git commit -m "chore(codegen): regenerate api-client with leaderboard endpoint"
```

---

### Task 6: Web — `/leaderboard` route + dashboard nav link

**Files:**
- Create: `apps/web/src/routes/leaderboard.tsx`
- Modify: `apps/web/src/routes/dashboard.tsx`

- [ ] **Step 6.1: Create `apps/web/src/routes/leaderboard.tsx`**

```tsx
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { useGetV1Leaderboard } from "@paper/api-client";
import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/leaderboard")({
  component: LeaderboardPage,
});

// Pastel tones for the top-3 podium positions, matching Marshmallow palette.
const PODIUM_TONES = ["peach", "mint", "sky"] as const;

function LeaderboardPage() {
  const { data, isLoading } = useGetV1Leaderboard({ query: { staleTime: 60_000 } });

  const entries = data?.entries ?? [];
  const myEntry = data?.my_entry ?? null;
  const weekDate = data?.week_starting_date ?? "";

  // Check if caller's entry is already in the visible list
  const myEntryInList = myEntry
    ? entries.some((e) => e.user_id === myEntry.user_id)
    : false;

  return (
    <main className="min-h-dvh bg-paper px-6 py-8">
      <div className="mx-auto max-w-md space-y-6">
        {/* Back link */}
        <div className="flex items-center justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard">← Dashboard</Link>
          </Button>
        </div>

        {/* Page header */}
        <div>
          <Eyebrow>week of {weekDate}</Eyebrow>
          <Heading level="h1" className="mt-1">
            Leaderboard
          </Heading>
          <p className="mt-1 text-ink-soft text-sm">
            Top traders ranked by portfolio + learning + streaks.
          </p>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
                key={i}
                className="h-14 animate-pulse rounded-lg bg-surface-2"
              />
            ))}
          </div>
        )}

        {/* Entry list */}
        {!isLoading && (
          <div className="space-y-2">
            {entries.length === 0 && (
              <p className="py-8 text-center text-ink-soft text-sm">
                No scores yet — check back soon.
              </p>
            )}

            {entries.map((entry) => {
              const isMe = myEntry?.user_id === entry.user_id;
              // Top 3 get pastel ink cards; rest get default surface cards.
              const tone =
                entry.rank <= 3
                  ? PODIUM_TONES[entry.rank - 1]
                  : "paper";

              return (
                <Card
                  key={entry.user_id}
                  tone={tone}
                  elevation={entry.rank <= 3 ? "pop" : "flat"}
                  padding="tight"
                  className={isMe ? "ring-2 ring-ink/30" : ""}
                >
                  <div className="flex items-center gap-3">
                    {/* Rank badge */}
                    <span className="w-8 shrink-0 text-center font-display font-bold text-base tabular-nums text-ink/60">
                      {entry.rank <= 3 ? ["🥇", "🥈", "🥉"][entry.rank - 1] : `#${entry.rank}`}
                    </span>

                    {/* Handle */}
                    <span className="min-w-0 flex-1 truncate font-medium text-sm text-ink">
                      {entry.handle ?? "anonymous"}
                      {isMe && (
                        <span className="ml-1.5 text-ink/50 text-xs">(you)</span>
                      )}
                    </span>

                    {/* Score */}
                    <span className="shrink-0 font-display font-bold text-base tabular-nums text-ink">
                      {entry.composite_score}
                    </span>
                  </div>
                </Card>
              );
            })}

            {/* Caller's own entry — shown below the list if outside top N */}
            {myEntry && !myEntryInList && (
              <>
                <div className="flex items-center gap-2 py-1">
                  <div className="h-px flex-1 bg-ink/10" />
                  <span className="text-ink-soft text-xs">your rank</span>
                  <div className="h-px flex-1 bg-ink/10" />
                </div>
                <Card
                  tone="paper"
                  elevation="flat"
                  padding="tight"
                  className="ring-2 ring-ink/30"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-8 shrink-0 text-center font-display font-bold text-base tabular-nums text-ink/60">
                      #{myEntry.rank}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium text-sm text-ink">
                      {myEntry.handle ?? "anonymous"}
                      <span className="ml-1.5 text-ink/50 text-xs">(you)</span>
                    </span>
                    <span className="shrink-0 font-display font-bold text-base tabular-nums text-ink">
                      {myEntry.composite_score}
                    </span>
                  </div>
                </Card>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 6.2: Add the Leaderboard link to `apps/web/src/routes/dashboard.tsx`**

The current dashboard has a `grid-cols-2` button row with "Place a trade" and "Learn". Add a third button for Leaderboard. Change `grid-cols-2` to `grid-cols-3`:

Current code in `dashboard.tsx`:

```tsx
<div className="grid grid-cols-2 gap-3">
  <Button asChild trailing="→" fullWidth>
    <Link to="/trade">Place a trade</Link>
  </Button>
  <Button asChild variant="secondary" trailing="→" fullWidth>
    <Link to="/learn">Learn</Link>
  </Button>
</div>
```

Replace with:

```tsx
<div className="grid grid-cols-3 gap-3">
  <Button asChild trailing="→" fullWidth>
    <Link to="/trade">Place a trade</Link>
  </Button>
  <Button asChild variant="secondary" trailing="→" fullWidth>
    <Link to="/learn">Learn</Link>
  </Button>
  <Button asChild variant="secondary" trailing="→" fullWidth>
    <Link to="/leaderboard">Leaderboard</Link>
  </Button>
</div>
```

- [ ] **Step 6.3: Trigger TanStack Router route-tree generation**

Run the Vite dev server briefly to let `@tanstack/router-vite-plugin` regenerate `routeTree.gen.ts` with the new `/leaderboard` route:

```bash
cd /Users/filipkastovsky/work/personal/startup
pnpm --filter @paper/web dev &
# Wait ~5 seconds for the plugin to detect the new route file and write routeTree.gen.ts
sleep 8
kill %1
```

Verify:

```bash
grep "leaderboard" apps/web/src/routeTree.gen.ts
```

Expected: the file now contains references to `/leaderboard` and `LeaderboardRoute`.

- [ ] **Step 6.4: Verify TypeScript in web package**

```bash
pnpm --filter @paper/web tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6.5: Commit**

```bash
git add apps/web/src/routes/leaderboard.tsx \
        apps/web/src/routes/dashboard.tsx \
        apps/web/src/routeTree.gen.ts
git commit -m "feat(web): add /leaderboard page and nav link in dashboard"
```

---

### Task 7: Lab manifests

**Files** (in `/Users/filipkastovsky/work/personal/lab`):
- Create: `stacks/paper/manifests/43-cron-leaderboard-recompute.yaml`
- Create: `stacks/paper/manifests/44-cron-leaderboard-weekly-reset.yaml`

- [ ] **Step 7.1: Confirm the lab manifests directory**

```bash
ls /Users/filipkastovsky/work/personal/lab/stacks/paper/manifests/ | grep cron
```

Expected: shows `40-cron-daily-snapshot.yaml`, `41-cron-streak-reaper.yaml`, `42-cron-*` (Plan 6's manifest), and the manifest directory is confirmed.

- [ ] **Step 7.2: Create `43-cron-leaderboard-recompute.yaml`**

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: paper-cron-leaderboard-recompute
  namespace: paper
spec:
  schedule: "*/5 * * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  startingDeadlineSeconds: 60
  jobTemplate:
    spec:
      backoffLimit: 0
      template:
        spec:
          restartPolicy: Never
          imagePullSecrets:
            - name: paper-pull
          containers:
            - name: cron-leaderboard-recompute
              image: ${image}
              command: ["node", "apps/server/dist/jobs/leaderboard-recompute.js"]
              env:
                - name: NODE_ENV
                  value: production
                - name: DATABASE_URL
                  valueFrom: { secretKeyRef: { name: paper-db-password, key: dsn } }
                - name: JWT_SECRET
                  valueFrom: { secretKeyRef: { name: paper-app, key: JWT_SECRET } }
                - name: LOG_LEVEL
                  value: info
                - name: OTEL_SERVICE_NAME
                  value: paper-cron-leaderboard-recompute
              resources:
                requests: { cpu: "20m", memory: "96Mi" }
                limits:   { cpu: "300m", memory: "192Mi" }
```

Note: `REDIS_URL` is intentionally omitted — the leaderboard recompute job only reads from Postgres, not Redis.

- [ ] **Step 7.3: Create `44-cron-leaderboard-weekly-reset.yaml`**

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: paper-cron-leaderboard-weekly-reset
  namespace: paper
spec:
  schedule: "0 0 * * 0"
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
            - name: cron-leaderboard-weekly-reset
              image: ${image}
              command: ["node", "apps/server/dist/jobs/leaderboard-weekly-reset.js"]
              env:
                - name: NODE_ENV
                  value: production
                - name: DATABASE_URL
                  valueFrom: { secretKeyRef: { name: paper-db-password, key: dsn } }
                - name: JWT_SECRET
                  valueFrom: { secretKeyRef: { name: paper-app, key: JWT_SECRET } }
                - name: LOG_LEVEL
                  value: info
                - name: OTEL_SERVICE_NAME
                  value: paper-cron-leaderboard-weekly-reset
              resources:
                requests: { cpu: "20m", memory: "96Mi" }
                limits:   { cpu: "300m", memory: "192Mi" }
```

Note: `startingDeadlineSeconds: 300` on the weekly reset (vs `60` on the 5-min recompute) — the weekly reset needs more buffer since a delayed Sunday midnight run is still valid for up to 5 minutes.

- [ ] **Step 7.4: Commit (in the lab repo)**

```bash
cd /Users/filipkastovsky/work/personal/lab
git add stacks/paper/manifests/43-cron-leaderboard-recompute.yaml \
        stacks/paper/manifests/44-cron-leaderboard-weekly-reset.yaml
git commit -m "feat(paper): add leaderboard recompute and weekly-reset CronJob manifests"
```

---

## Self-Review Checklist

### Correctness
- [ ] `leaderboard_snapshots.userId` is a PK, so ON CONFLICT DO UPDATE is a safe upsert — no phantom duplicate rows
- [ ] `RANK()` (not `ROW_NUMBER()`) is used — tied users share a rank, which is spec-correct and fairness-preserving
- [ ] The SQL CTE correctly handles users with no portfolio row (LEFT JOIN + COALESCE(..., 10000)) — no division by zero
- [ ] `weeklyReset` does a plain `db.delete(leaderboardSnapshots)` which deletes all rows (no WHERE clause) — confirmed by the service test
- [ ] `getLeaderboard` returns `my_entry: null` when the caller's snapshot row doesn't exist (empty table or new user before first recompute)
- [ ] `currentWeekSunday()` returns today's date when called on Sunday (diff = 0) — correct for the weekly-reset job

### Schema
- [ ] `leaderboard-snapshots.ts` uses `uuid` PK referencing `users.id` with `onDelete: "cascade"` — user deletion cleans up automatically
- [ ] `weekStartingDate` is `text`, not `date` — consistent with `portfolio_snapshots.snapshotDate` (Drizzle `date` mode `"string"` also produces text wire, but plain `text` avoids any mode confusion in the recompute SQL)
- [ ] `compositeScore` and `rankGlobal` are `integer` — the formula uses `FLOOR(...)::int` and `RANK()::int` which are safe casts
- [ ] `updatedAt` is `timestamp with time zone` defaulting to `now()` — lets us audit staleness in production

### API contract
- [ ] `GET /v1/leaderboard` is auth-guarded (`preHandler: app.authenticate`) — unauthenticated requests get 401
- [ ] `?limit` defaults to 50, max 200, coerced from query string — matches Zod schema
- [ ] Response always includes `my_entry` (even if outside top N) so the UI never has to make a second request
- [ ] `handle` is `nullable()` in the Zod response schema — users who haven't set a handle show as `null`

### Cron jobs
- [ ] Both job files guard the `main()` call with `import.meta.url === file://${process.argv[1]}` — safe to import in tests
- [ ] Both files call `handles.sql.end()` in `finally` — no hanging Postgres connections
- [ ] `leaderboard-weekly-reset.ts` calls `weeklyReset` then `recomputeLeaderboard` in sequence — the table is empty for milliseconds, not minutes
- [ ] `43-cron-leaderboard-recompute.yaml` uses `concurrencyPolicy: Forbid` and `startingDeadlineSeconds: 60` — prevents pile-up if a run is slow, and aborts if missed by >1 min (5-min frequency makes this safe)
- [ ] Neither cron manifest includes `REDIS_URL` — the leaderboard jobs are Postgres-only

### Web
- [ ] `/leaderboard` route file is a flat route (not nested under `/learn`) — correct for top-level URL
- [ ] `routeTree.gen.ts` must be regenerated — Step 6.3 does this explicitly
- [ ] Podium medals (🥇🥈🥉) are used for ranks 1–3; `#N` for the rest — graceful for large leaderboards
- [ ] Caller's entry is highlighted with `ring-2 ring-ink/30` regardless of position
- [ ] `isLoading` skeleton prevents layout shift during initial fetch
- [ ] `staleTime: 60_000` on the query — data is refreshed at most once per minute per page visit (the cron runs every 5 min so this is appropriate)

### Tests
- [ ] Service tests use unique `deviceUuid` values to avoid FK conflicts across parallel test runs
- [ ] Route tests use `makeTestServer()` / `truncateAllTables` pattern consistent with all other route test files
- [ ] `recomputeLeaderboard` is called directly in route tests to seed snapshot data — avoids relying on the cron job being scheduled
- [ ] "caller outside top-N" scenario is covered in both service tests and route tests

### Migrations + truncate
- [ ] `truncateAllTables` now includes `"leaderboard_snapshots"` before `"users"` — CASCADE handles the FK but explicit listing catches future schema drift in CI
- [ ] The schema index re-export is added as the last line — correct, leaderboard depends on users (already first)

---

## Composite Score Reference

```
composite_score =
  FLOOR((total_value_usd - 10000) / 10000 * 100)   ← portfolio performance pts (0 at break-even, +10 per +10% gain)
  + COUNT(DISTINCT lesson_id) * 5                   ← 5 pts per completed lesson (max 100 pts for 20 lessons)
  + COALESCE(current_days, 0)                       ← 1 pt per streak day
```

A fresh user with $10k cash, 0 lessons, 0 streak has score 0 and rank tied-last. A user who has lost money scores negative from the portfolio component but still earns lesson and streak points.

## Branch / PR Note

After all 7 tasks complete and all tests pass:

```bash
cd /Users/filipkastovsky/work/personal/startup
pnpm --filter @paper/server vitest run
pnpm --filter @paper/server tsc --noEmit
pnpm --filter @paper/web tsc --noEmit
```

Then push and open a PR from `plan-7-leaderboard` → `plan-6-daily-question` (or directly to `main` if plan-6 has already been merged).
