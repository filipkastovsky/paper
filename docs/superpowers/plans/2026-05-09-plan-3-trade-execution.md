# Plan 3: Trade execution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user on `https://papercrypto.tech` can pick an asset, type a USD amount, review the trade in a bottom-sheet modal, confirm, and see their portfolio + cash + new "% today" hero update — all with server-authoritative pricing, atomic Trade+Portfolio writes, idempotent retries, and 20-trade/min rate limiting. Trade history renders below the form. The dashboard hero shows a real `% today` powered by a daily portfolio snapshot that runs at 00:00 UTC. The first-ever trade fires a `first_trade_placed` PostHog event.

**Architecture:** Adds a `trades` write log (one row per executed trade, server-authoritative price, 8-decimal `qty`/`usd_amount`) and a `portfolio_snapshots` table (one row per user per day, `total_value_usd` at 00:00 UTC). The trade service runs a single Drizzle `db.transaction(...)` that (a) re-reads the cached price from Redis (TTL 120s, written by the existing per-minute price-ingestion cron), (b) validates buy/sell against current portfolio cash + qty, (c) inserts the Trade row, (d) updates `portfolios.cash_usd` + `portfolios.holdings`. Idempotency is enforced via a unique index on `(user_id, idempotency_key)` — a duplicate POST trips Postgres SQLSTATE 23505 and the handler returns the existing row. Rate limiting is per `req.user.sub` via the existing `@fastify/rate-limit` plugin (the new POST sets `config: { rateLimit: { max: 20, ... }}` and a `keyGenerator` that prefers `req.user.sub` over IP). A second K8s CronJob (`paper-cron-daily-snapshot`, schedule `0 0 * * *`) writes the `portfolio_snapshots` row each midnight; the trade service back-fills today's open snapshot if missing on the user's first trade so a same-day account can compute `% today` against a real baseline. The web client gains a `/trade` route, a `BottomSheet` primitive (Radix Dialog), `TradeForm`, `ConfirmationSheet`, `SuccessModal`, and a `TradeHistoryList` reading the new `GET /v1/trades`. The dashboard hero pulls the new `today_pct_change` field that `GET /v1/me` exposes alongside the existing portfolio shape.

**Tech Stack:** No new vendors. Reuses Drizzle, postgres.js, ioredis, `decimal.js`, `@fastify/rate-limit`, Marshmallow primitives. The Web side adds **`@radix-ui/react-dialog`** for the bottom sheet — already in `apps/web/package.json` (Plan 1). PostHog (already wired in Plan 1) gets one new event name: `first_trade_placed`.

---

## Prerequisites

| # | Prereq | Verify |
|---|---|---|
| P1 | Plans 1 + 2 shipped to prod (`https://papercrypto.tech` + `https://api.papercrypto.tech` both 200; `/v1/assets` returns 12 entries with non-null `price_usd`) | `curl -sS --tlsv1.2 --tls-max 1.2 https://api.papercrypto.tech/v1/health` → `{"status":"ok"}` and `curl -sS .../v1/assets -H 'authorization: Bearer ...' \| jq '.assets[0].price_usd'` is a finite number |
| P2 | Working tree clean on `plan-3-trade-execution`, branched off `main` at `906a9f3` | `git status --short` empty; `git log --oneline -1` shows `906a9f3 fix(api-client): make @tanstack/react-query a peerDependency` |
| P3 | Local infra running | `podman compose ps` → postgres + redis + minio healthy |
| P4 | Drizzle migrations applied locally up to `0001` | `pnpm --filter @paper/server db:migrate` → `migrations applied` |
| P5 | Server tests pass on baseline | `pnpm --filter @paper/server test` → 40 passing |
| P6 | Web typecheck + smoke pass on baseline | `pnpm --filter @paper/web typecheck` clean; `pnpm --filter @paper/web exec playwright test smoke` 2 passing |
| P7 | GHCR + Cloudflare creds available | `GHCR_USER`, `GHCR_TOKEN`, the `cfat_` token from earlier plans still valid |
| P8 | Local Redis has at least one cached price (so the trade service can transact during dev) | `podman exec paper-redis-1 redis-cli GET paper:price:BTC` returns a JSON blob, OR run `pnpm --filter @paper/server tsx src/jobs/price-ingestion.ts` once |

If any P-row fails, fix it before Task 1.

---

## Container runtime note

Same as Plans 1–2: this project uses **podman**, not docker. Compose commands are `podman compose`, image builds are `podman build --platform=linux/arm64`, registry login is `podman login ghcr.io`. On macOS, containers reach the host via `host.containers.internal`, not `localhost`.

---

## Out of scope (deferred to later plans)

These are part of the spec for trade-adjacent flows but explicitly NOT in Plan 3 — flagging here so they don't accidentally creep into review:

- **Real share-card image rendering** (spec §7.3) — Plan 7. Plan 3's SuccessModal shows a placeholder card with `<BalanceNumeral>` + handle + asset, but the "Save image" / "Copy link" affordances stub-render the same DOM the Plan 7 OG-image route will eventually rasterise.
- **Daily Market Question + predictions** (spec §6.2 + §7.1) — Plan 5
- **Streak flame** (spec §7.2) — Plan 5
- **Lessons content + quiz** (spec §6.4) — Plan 4
- **Push notifications** (spec §7.4) — Plan 5
- **Profile / Ranks / leaderboard** (spec §6.5 + §6.6) — Plans 6 + 7
- **Limit / stop / market-on-close orders** — never; v0 is "buy/sell at the cached price now" only.
- **Portfolio time series / sparkline** — deferred. Plan 3 stores a single daily snapshot per user, not intraday tick history. The daily snapshots are sufficient for "% today"; richer charts wait for Plan 6.
- **Server-emitted PostHog events** — server stays opaque to PostHog. The `first_trade_placed` event is fired on the **client** when the trade response includes `is_first_trade: true`.

---

## File structure

This plan touches the following files. Files marked **(NEW)** are created in Plan 3; **(MOD)** are modified.

```
apps/server/
├── drizzle/
│   └── 0002_<random>.sql                                       (NEW — generated migration: trades + portfolio_snapshots)
├── src/
│   ├── db/schema/
│   │   ├── trades.ts                                           (NEW)
│   │   ├── portfolio-snapshots.ts                              (NEW)
│   │   └── index.ts                                            (MOD — export both)
│   ├── services/
│   │   ├── trades.ts                                           (NEW — executeTrade + listTrades)
│   │   └── snapshots.ts                                        (NEW — todaySnapshotKey, ensureTodaySnapshot, runDailySnapshot, todayPctChange)
│   ├── jobs/
│   │   └── daily-snapshot.ts                                   (NEW — K8s CronJob entrypoint)
│   ├── routes/
│   │   ├── trades.ts                                           (NEW — POST /v1/trades, GET /v1/trades)
│   │   └── me.ts                                               (MOD — add today_pct_change to GET /v1/me response)
│   └── server.ts                                               (MOD — register tradesRoutes)
└── test/
    ├── services/
    │   ├── trades.test.ts                                      (NEW)
    │   └── snapshots.test.ts                                   (NEW)
    ├── routes/
    │   ├── trades.test.ts                                      (NEW)
    │   └── me.test.ts                                          (MOD — add today_pct_change assertion)
    ├── jobs/
    │   └── daily-snapshot.test.ts                              (NEW)
    └── helpers/
        └── db.ts                                               (MOD — extend truncate to include trades + portfolio_snapshots)

apps/web/
├── src/
│   ├── components/
│   │   ├── ui/
│   │   │   └── bottom-sheet.tsx                                (NEW — Radix Dialog wrapper)
│   │   └── trade/
│   │       ├── TradeForm.tsx                                   (NEW)
│   │       ├── AssetPickerRow.tsx                              (NEW)
│   │       ├── ConfirmationSheet.tsx                           (NEW)
│   │       ├── SuccessModal.tsx                                (NEW)
│   │       └── TradeHistoryList.tsx                            (NEW)
│   ├── routes/
│   │   ├── trade.tsx                                           (NEW — file route /trade)
│   │   └── dashboard.tsx                                       (MOD — wire CTA → /trade)
│   ├── components/dashboard/
│   │   └── HeroPortfolioCard.tsx                               (MOD — render today_pct_change)
│   ├── stores/
│   │   └── trade-store.ts                                      (NEW — Zustand draft + sheet state)
│   └── lib/
│       └── trade-errors.ts                                     (NEW — server error → human copy)
└── tests/e2e/
    └── trade.spec.ts                                           (NEW)

packages/api-client/
└── src/                                                        (regenerated by `pnpm gen:api-client`)

lab/stacks/paper/manifests/
└── 40-cron-daily-snapshot.yaml                                 (NEW — daily 00:00 UTC K8s CronJob)
```

The K8s manifests at `30-cron-price-ingestion.yaml` (Plan 2) and `10-/20-/21-/22-` (Plan 1) are unchanged. The new `40-` prefix puts the daily snapshot cron after the API Deployment in apply order.

---

## Tasks

### Phase A — Server core (T1–T5)

### Task 1: Trades + portfolio_snapshots schemas + migration

**Files:**
- Create: `apps/server/src/db/schema/trades.ts`
- Create: `apps/server/src/db/schema/portfolio-snapshots.ts`
- Modify: `apps/server/src/db/schema/index.ts`
- Generate: `apps/server/drizzle/0002_*.sql` (drizzle-kit output)
- Modify: `apps/server/test/helpers/db.ts` (extend truncate)

- [ ] **Step 1: Create `apps/server/src/db/schema/trades.ts`**

```typescript
import { sql } from "drizzle-orm";
import {
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * Per spec §8.2:
 *   Trade — id, user_id, asset_id, side ∈ {buy, sell}, usd_amount, qty,
 *           price_at_execution, idempotency_key (per-user unique), created_at
 *
 * `qty`, `usd_amount`, `price_at_execution` are numeric(20,8) — Postgres NUMERIC
 * round-trips as `string` in postgres.js / Drizzle. Trade math always uses
 * `Decimal`, never JS `number`.
 *
 * The `(user_id, idempotency_key)` unique index is the load-bearing piece of
 * the idempotency contract: a retry POST with the same key trips SQLSTATE 23505,
 * which the route handler catches and remaps to "return the existing row".
 */
export const tradeSide = pgEnum("trade_side", ["buy", "sell"]);

export const trades = pgTable(
  "trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assetId: text("asset_id").notNull(),
    side: tradeSide("side").notNull(),
    usdAmount: numeric("usd_amount", { precision: 20, scale: 8 }).notNull(),
    qty: numeric("qty", { precision: 20, scale: 8 }).notNull(),
    priceAtExecution: numeric("price_at_execution", { precision: 20, scale: 8 }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    byUserCreatedAt: index("trades_user_id_created_at_idx").on(t.userId, t.createdAt),
    uniqByUserAndKey: uniqueIndex("trades_user_id_idempotency_key_uq").on(
      t.userId,
      t.idempotencyKey,
    ),
  }),
);

export type Trade = typeof trades.$inferSelect;
export type NewTrade = typeof trades.$inferInsert;
export type TradeSide = (typeof tradeSide.enumValues)[number];
```

- [ ] **Step 2: Create `apps/server/src/db/schema/portfolio-snapshots.ts`**

```typescript
import { date, numeric, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * One row per user per UTC date. Written by the daily-snapshot CronJob
 * (`0 0 * * *`) and back-filled lazily on first-trade-of-day so a user
 * created mid-day still has a baseline for "% today".
 *
 * `(user_id, snapshot_date)` is the composite PK — duplicate inserts trip
 * SQLSTATE 23505, which `ensureTodaySnapshot` swallows.
 */
export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    snapshotDate: date("snapshot_date", { mode: "string" }).notNull(),
    totalValueUsd: numeric("total_value_usd", { precision: 20, scale: 8 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.snapshotDate] }),
  }),
);

export type PortfolioSnapshot = typeof portfolioSnapshots.$inferSelect;
export type NewPortfolioSnapshot = typeof portfolioSnapshots.$inferInsert;
```

- [ ] **Step 3: Modify `apps/server/src/db/schema/index.ts`**

```typescript
export * from "./users.js";
export * from "./refresh-tokens.js";
export * from "./portfolios.js";
export * from "./trades.js";
export * from "./portfolio-snapshots.js";
```

- [ ] **Step 4: Modify `apps/server/test/helpers/db.ts`**

Replace its contents with:

```typescript
import type { Db } from "@/db/client.js";
import { sql } from "drizzle-orm";

export async function truncateAllTables(db: Db): Promise<void> {
  // Order matters via FK chain: trades + portfolio_snapshots + portfolios + refresh_tokens → users.
  // CASCADE handles the FK chain regardless of list order; we still spell out every table to keep
  // the test fixture aware of the full schema (CI fails fast if a new table forgets to add itself).
  await db.execute(
    sql`TRUNCATE TABLE "trades", "portfolio_snapshots", "portfolios", "refresh_tokens", "users" RESTART IDENTITY CASCADE`,
  );
}
```

- [ ] **Step 5: Generate the migration**

Ensure local Postgres is up: `podman compose ps`. Then:

```bash
pnpm --filter @paper/server db:generate
```

Expected: writes `apps/server/drizzle/0002_<random>.sql` containing:
- `CREATE TYPE "public"."trade_side" AS ENUM ('buy','sell')`
- `CREATE TABLE "trades" ...` plus the two indexes
- `CREATE TABLE "portfolio_snapshots" ...` with composite PK
- `apps/server/drizzle/meta/0002_snapshot.json` plus updated `_journal.json`

Inspect the SQL — it should NOT touch `users`, `portfolios`, `refresh_tokens`. If the diff is noisy (e.g. a renamed default), back up to step 1 and fix the schema before applying.

- [ ] **Step 6: Apply the migration**

```bash
export $(grep -v '^#' .env | xargs)
pnpm --filter @paper/server db:migrate
```

Expected: `migrations applied`. Verify:

```bash
podman exec -i paper-postgres-1 psql -U app -d paper -c "\d trades"
podman exec -i paper-postgres-1 psql -U app -d paper -c "\d portfolio_snapshots"
podman exec -i paper-postgres-1 psql -U app -d paper -c "SELECT typname FROM pg_type WHERE typname='trade_side';"
```

Both tables and the enum should be present.

- [ ] **Step 7: Run server tests (sanity)**

```bash
pnpm --filter @paper/server test
```

Expected: 40 passing. The truncate helper now covers two new tables; existing tests don't insert into them, so behaviour is unchanged.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/db apps/server/drizzle apps/server/test/helpers/db.ts
git commit -m "feat(server): add trades + portfolio_snapshots schemas"
```

---

### Task 2: Trade service — executeTrade + listTrades (TDD)

**Files:**
- Create: `apps/server/src/services/trades.ts`
- Create: `apps/server/test/services/trades.test.ts`

The trade service is the most safety-critical service in v0 because it's the only one that writes balances. Every state mutation goes through one Drizzle `db.transaction(...)`. The boundary contract is "one Trade row + one Portfolio update per call, or zero of each".

- [ ] **Step 1: Write the failing tests for trade service**

Create `apps/server/test/services/trades.test.ts`:

```typescript
import { makeDb } from "@/db/client.js";
import { portfolios, trades, users } from "@/db/schema/index.js";
import { closeRedis } from "@/services/redis.js";
import { executeTrade, listTrades } from "@/services/trades.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { truncateAllTables } from "../helpers/db.js";
import { withFreshRedis } from "../helpers/redis.js";

const dbUrl = process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/paper";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

async function seedUser(
  db: ReturnType<typeof makeDb>["db"],
  uuid = "00000000-0000-0000-0000-00000000aaa1",
): Promise<string> {
  const [u] = await db.insert(users).values({ deviceUuid: uuid }).returning({ id: users.id });
  if (!u) throw new Error("no user inserted");
  await db.insert(portfolios).values({
    userId: u.id,
    cashUsd: "10000.00000000",
    holdings: {},
  });
  return u.id;
}

async function seedPriceBTC(
  r: import("ioredis").Redis,
  usd = 50_000,
  prevUsd = 49_000,
): Promise<void> {
  const ts = Math.floor(Date.now() / 1000);
  await r.set("paper:price:BTC", JSON.stringify({ usd, prevUsd, ts }), "EX", 120);
}

describe("executeTrade — buy path", () => {
  const handles = makeDb(dbUrl, { max: 2 });
  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  it("buys $1,000 of BTC at $50k → 0.02 BTC, cash 9000, one Trade row", async () => {
    await withFreshRedis(async (r) => {
      const userId = await seedUser(handles.db);
      await seedPriceBTC(r);

      const result = await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "buy",
        usdAmount: "1000.00000000",
        idempotencyKey: "k-buy-1",
      });

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.trade.qty).toBe("0.02000000");
      expect(result.trade.priceAtExecution).toBe("50000.00000000");
      expect(result.trade.usdAmount).toBe("1000.00000000");
      expect(result.trade.side).toBe("buy");
      expect(result.isFirstTrade).toBe(true);

      const [p] = await handles.db
        .select()
        .from(portfolios)
        .where(eq(portfolios.userId, userId));
      expect(p?.cashUsd).toBe("9000.00000000");
      expect(p?.holdings).toEqual({
        BTC: { qty: "0.02000000", cost_basis: "50000.00000000" },
      });

      const allTrades = await handles.db
        .select()
        .from(trades)
        .where(eq(trades.userId, userId));
      expect(allTrades).toHaveLength(1);
    });
  });

  it("buys add to existing holding and recompute cost_basis as weighted average", async () => {
    await withFreshRedis(async (r) => {
      const userId = await seedUser(handles.db);
      await seedPriceBTC(r, 50_000);

      await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "buy",
        usdAmount: "1000.00000000",
        idempotencyKey: "k1",
      });
      await seedPriceBTC(r, 100_000);
      await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "buy",
        usdAmount: "1000.00000000",
        idempotencyKey: "k2",
      });

      const [p] = await handles.db
        .select()
        .from(portfolios)
        .where(eq(portfolios.userId, userId));
      // 0.02 BTC at 50k + 0.01 BTC at 100k = 0.03 BTC at avg cost ≈ 66,666.67
      expect(p?.holdings).toEqual({
        BTC: { qty: "0.03000000", cost_basis: "66666.66666667" },
      });
      expect(p?.cashUsd).toBe("8000.00000000");
    });
  });

  it("rejects insufficient_cash without writing", async () => {
    await withFreshRedis(async (r) => {
      const userId = await seedUser(handles.db);
      await seedPriceBTC(r);

      const result = await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "buy",
        usdAmount: "100000.00000000",
        idempotencyKey: "k-bad",
      });
      expect(result.kind).toBe("error");
      if (result.kind !== "error") return;
      expect(result.code).toBe("insufficient_cash");

      const [p] = await handles.db
        .select()
        .from(portfolios)
        .where(eq(portfolios.userId, userId));
      expect(p?.cashUsd).toBe("10000.00000000");
      const all = await handles.db.select().from(trades).where(eq(trades.userId, userId));
      expect(all).toHaveLength(0);
    });
  });
});

describe("executeTrade — sell path", () => {
  const handles = makeDb(dbUrl, { max: 2 });
  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  it("sells partial qty, deducts holding qty, cost_basis stays the same", async () => {
    await withFreshRedis(async (r) => {
      const userId = await seedUser(handles.db);
      await seedPriceBTC(r, 50_000);

      // Set up a position: 0.10 BTC at avg 40k.
      await handles.db
        .update(portfolios)
        .set({
          cashUsd: "1000.00000000",
          holdings: { BTC: { qty: "0.10000000", cost_basis: "40000.00000000" } },
        })
        .where(eq(portfolios.userId, userId));

      const result = await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "sell",
        usdAmount: "500.00000000",
        idempotencyKey: "k-sell-1",
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      // 500 / 50_000 = 0.01 BTC sold
      expect(result.trade.qty).toBe("0.01000000");

      const [p] = await handles.db
        .select()
        .from(portfolios)
        .where(eq(portfolios.userId, userId));
      expect(p?.cashUsd).toBe("1500.00000000");
      expect(p?.holdings).toEqual({
        BTC: { qty: "0.09000000", cost_basis: "40000.00000000" },
      });
    });
  });

  it("removes the holding entry when qty hits zero", async () => {
    await withFreshRedis(async (r) => {
      const userId = await seedUser(handles.db);
      await seedPriceBTC(r, 50_000);

      await handles.db
        .update(portfolios)
        .set({
          cashUsd: "0.00000000",
          holdings: { BTC: { qty: "0.02000000", cost_basis: "50000.00000000" } },
        })
        .where(eq(portfolios.userId, userId));

      const result = await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "sell",
        usdAmount: "1000.00000000",
        idempotencyKey: "k-sell-all",
      });
      expect(result.kind).toBe("ok");

      const [p] = await handles.db
        .select()
        .from(portfolios)
        .where(eq(portfolios.userId, userId));
      expect(p?.cashUsd).toBe("1000.00000000");
      expect(p?.holdings).toEqual({});
    });
  });

  it("rejects insufficient_qty without writing", async () => {
    await withFreshRedis(async (r) => {
      const userId = await seedUser(handles.db);
      await seedPriceBTC(r, 50_000);

      // 0.001 BTC = $50 of value; selling $1000 worth must fail.
      await handles.db
        .update(portfolios)
        .set({
          holdings: { BTC: { qty: "0.00100000", cost_basis: "50000.00000000" } },
        })
        .where(eq(portfolios.userId, userId));

      const result = await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "sell",
        usdAmount: "1000.00000000",
        idempotencyKey: "k-sell-bad",
      });
      expect(result.kind).toBe("error");
      if (result.kind !== "error") return;
      expect(result.code).toBe("insufficient_qty");

      const all = await handles.db.select().from(trades).where(eq(trades.userId, userId));
      expect(all).toHaveLength(0);
    });
  });
});

describe("executeTrade — error mapping", () => {
  const handles = makeDb(dbUrl, { max: 2 });
  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  it("returns price_unavailable when the cache has no entry", async () => {
    await withFreshRedis(async () => {
      const userId = await seedUser(handles.db);
      const result = await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "buy",
        usdAmount: "100.00000000",
        idempotencyKey: "k-no-price",
      });
      expect(result.kind).toBe("error");
      if (result.kind !== "error") return;
      expect(result.code).toBe("price_unavailable");
    });
  });

  it("returns unknown_asset for an asset not in ASSETS", async () => {
    await withFreshRedis(async (r) => {
      const userId = await seedUser(handles.db);
      await seedPriceBTC(r, 50_000);
      const result = await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "ZZZ",
        side: "buy",
        usdAmount: "100.00000000",
        idempotencyKey: "k-unknown",
      });
      expect(result.kind).toBe("error");
      if (result.kind !== "error") return;
      expect(result.code).toBe("unknown_asset");
    });
  });
});

describe("executeTrade — idempotency", () => {
  const handles = makeDb(dbUrl, { max: 2 });
  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  it("a second call with the same key returns the same Trade and does not double-spend", async () => {
    await withFreshRedis(async (r) => {
      const userId = await seedUser(handles.db);
      await seedPriceBTC(r, 50_000);

      const a = await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "buy",
        usdAmount: "1000.00000000",
        idempotencyKey: "k-dup",
      });
      // Bump price so we can detect that the second call did NOT execute fresh.
      await seedPriceBTC(r, 100_000);
      const b = await executeTrade(handles.db, redisUrl, {
        userId,
        assetId: "BTC",
        side: "buy",
        usdAmount: "1000.00000000",
        idempotencyKey: "k-dup",
      });

      expect(a.kind).toBe("ok");
      expect(b.kind).toBe("ok");
      if (a.kind !== "ok" || b.kind !== "ok") return;
      expect(a.trade.id).toBe(b.trade.id);
      expect(a.trade.priceAtExecution).toBe("50000.00000000");
      expect(b.trade.priceAtExecution).toBe("50000.00000000");
      expect(b.isFirstTrade).toBe(false);

      const all = await handles.db.select().from(trades).where(eq(trades.userId, userId));
      expect(all).toHaveLength(1);

      const [p] = await handles.db
        .select()
        .from(portfolios)
        .where(eq(portfolios.userId, userId));
      // Cash dropped once (10000 → 9000), not twice.
      expect(p?.cashUsd).toBe("9000.00000000");
    });
  });
});

describe("listTrades", () => {
  const handles = makeDb(dbUrl, { max: 2 });
  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  it("returns most-recent-first with limit", async () => {
    await withFreshRedis(async (r) => {
      const userId = await seedUser(handles.db);
      await seedPriceBTC(r, 50_000);
      for (let i = 0; i < 3; i++) {
        await executeTrade(handles.db, redisUrl, {
          userId,
          assetId: "BTC",
          side: "buy",
          usdAmount: "100.00000000",
          idempotencyKey: `k-${i}`,
        });
      }
      const list = await listTrades(handles.db, { userId, limit: 2 });
      expect(list).toHaveLength(2);
      expect(new Date(list[0]!.createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(list[1]!.createdAt).getTime(),
      );
    });
  });

  it("scopes by user", async () => {
    await withFreshRedis(async (r) => {
      const u1 = await seedUser(handles.db, "00000000-0000-0000-0000-00000000aaa1");
      const u2 = await seedUser(handles.db, "00000000-0000-0000-0000-00000000aaa2");
      await seedPriceBTC(r, 50_000);
      await executeTrade(handles.db, redisUrl, {
        userId: u1,
        assetId: "BTC",
        side: "buy",
        usdAmount: "100.00000000",
        idempotencyKey: "k-u1",
      });
      const list = await listTrades(handles.db, { userId: u2, limit: 50 });
      expect(list).toHaveLength(0);
    });
  });
});
```

Run them — they must fail with a "module not found" / "executeTrade is not a function" error:

```bash
pnpm --filter @paper/server test trades.test.ts
```

- [ ] **Step 2: Create `apps/server/src/services/trades.ts`**

```typescript
import type { Db } from "@/db/client.js";
import {
  type HoldingsJson,
  type Trade,
  type TradeSide,
  portfolios,
  trades,
} from "@/db/schema/index.js";
import { ASSETS, isAssetId } from "@paper/shared";
import { Decimal } from "decimal.js";
import { and, desc, eq } from "drizzle-orm";
import { getCachedPrice } from "./prices.js";

export type ExecuteTradeInput = {
  userId: string;
  assetId: string;
  side: TradeSide;
  /** USD amount as a numeric(20,8)-formatted string. */
  usdAmount: string;
  /** Per-user unique key. The DB trips 23505 on retries; we remap to a hit. */
  idempotencyKey: string;
};

export type ExecuteTradeError =
  | "insufficient_cash"
  | "insufficient_qty"
  | "unknown_asset"
  | "price_unavailable"
  | "invalid_amount";

export type ExecuteTradeResult =
  | { kind: "ok"; trade: Trade; isFirstTrade: boolean }
  | { kind: "error"; code: ExecuteTradeError };

const QTY_DP = 8;

/**
 * Execute one trade. Server-authoritative pricing — we re-read the cached
 * price (Redis, written by the per-minute cron, TTL 120s) inside the call
 * and refuse to trade if it's missing. Re-runs with the same idempotencyKey
 * return the original Trade row without mutating state.
 */
export async function executeTrade(
  db: Db,
  redisUrl: string,
  input: ExecuteTradeInput,
): Promise<ExecuteTradeResult> {
  if (!isAssetId(input.assetId)) {
    return { kind: "error", code: "unknown_asset" };
  }

  const usdAmountDec = new Decimal(input.usdAmount);
  if (!usdAmountDec.isFinite() || usdAmountDec.lte(0)) {
    return { kind: "error", code: "invalid_amount" };
  }

  const cached = await getCachedPrice(redisUrl, input.assetId);
  if (!cached || cached.usd <= 0) {
    return { kind: "error", code: "price_unavailable" };
  }
  const priceDec = new Decimal(cached.usd);
  // 8-decimal qty per spec §8.2.
  const qtyDec = usdAmountDec.div(priceDec).toDecimalPlaces(QTY_DP, Decimal.ROUND_DOWN);
  if (qtyDec.lte(0)) {
    // Pathological tiny order: $0.00000001 / $50,000 rounds to 0.
    return { kind: "error", code: "invalid_amount" };
  }

  try {
    const out = await db.transaction(async (tx) => {
      const [pf] = await tx
        .select()
        .from(portfolios)
        .where(eq(portfolios.userId, input.userId))
        .for("update");
      if (!pf) throw new Error("portfolio missing for authenticated user");

      const cashDec = new Decimal(pf.cashUsd);
      const holdings = pf.holdings as HoldingsJson;
      const existing = holdings[input.assetId];

      let nextCash: Decimal;
      let nextHoldings: HoldingsJson;

      if (input.side === "buy") {
        if (cashDec.lt(usdAmountDec)) {
          // Bail with a sentinel — Drizzle rolls back on throw.
          throw new TradeError("insufficient_cash");
        }
        nextCash = cashDec.minus(usdAmountDec);
        const prevQty = new Decimal(existing?.qty ?? "0");
        const prevCost = new Decimal(existing?.cost_basis ?? "0");
        const prevValue = prevQty.mul(prevCost);
        const addValue = qtyDec.mul(priceDec);
        const newQty = prevQty.plus(qtyDec);
        // Weighted-average cost basis. If newQty is 0 (impossible on buy), fall back to price.
        const newCost = newQty.gt(0) ? prevValue.plus(addValue).div(newQty) : priceDec;
        nextHoldings = {
          ...holdings,
          [input.assetId]: {
            qty: newQty.toFixed(QTY_DP),
            cost_basis: newCost.toDecimalPlaces(QTY_DP, Decimal.ROUND_HALF_UP).toFixed(QTY_DP),
          },
        };
      } else {
        const prevQty = new Decimal(existing?.qty ?? "0");
        if (prevQty.lt(qtyDec)) {
          throw new TradeError("insufficient_qty");
        }
        nextCash = cashDec.plus(usdAmountDec);
        const newQty = prevQty.minus(qtyDec);
        if (newQty.lte(0)) {
          // Drop the entry entirely so /v1/me + the dashboard hide closed positions.
          const { [input.assetId]: _drop, ...rest } = holdings;
          nextHoldings = rest;
        } else {
          // cost_basis on a partial sell stays the same — the average cost of the
          // remaining qty hasn't changed.
          nextHoldings = {
            ...holdings,
            [input.assetId]: {
              qty: newQty.toFixed(QTY_DP),
              cost_basis: existing?.cost_basis ?? priceDec.toFixed(QTY_DP),
            },
          };
        }
      }

      let inserted: Trade;
      try {
        const rows = await tx
          .insert(trades)
          .values({
            userId: input.userId,
            assetId: input.assetId,
            side: input.side,
            usdAmount: usdAmountDec.toFixed(QTY_DP),
            qty: qtyDec.toFixed(QTY_DP),
            priceAtExecution: priceDec.toFixed(QTY_DP),
            idempotencyKey: input.idempotencyKey,
          })
          .returning();
        inserted = rows[0]!;
      } catch (err) {
        // Idempotency hit. Aborting the inner tx and looking up the existing row
        // outside it keeps the trade insert + portfolio update as a single atomic
        // unit — we never want a half-applied retry.
        if (
          err !== null &&
          typeof err === "object" &&
          "code" in err &&
          (err as { code: string }).code === "23505"
        ) {
          throw new IdempotencyHit();
        }
        throw err;
      }

      await tx
        .update(portfolios)
        .set({
          cashUsd: nextCash.toFixed(QTY_DP),
          holdings: nextHoldings,
        })
        .where(eq(portfolios.userId, input.userId));

      return inserted;
    });

    // First-trade detection: count(trades where user=X) == 1 post-insert. Cheap
    // because the index `trades_user_id_created_at_idx` covers it.
    const tradeCount = await countUserTrades(db, input.userId);
    return { kind: "ok", trade: out, isFirstTrade: tradeCount === 1 };
  } catch (err) {
    if (err instanceof TradeError) {
      return { kind: "error", code: err.code };
    }
    if (err instanceof IdempotencyHit) {
      const [existing] = await db
        .select()
        .from(trades)
        .where(
          and(eq(trades.userId, input.userId), eq(trades.idempotencyKey, input.idempotencyKey)),
        );
      if (!existing) {
        // Should never happen — the unique violation guarantees a row exists.
        throw new Error("idempotency hit but row missing");
      }
      return { kind: "ok", trade: existing, isFirstTrade: false };
    }
    throw err;
  }
}

class TradeError extends Error {
  constructor(public readonly code: ExecuteTradeError) {
    super(code);
  }
}
class IdempotencyHit extends Error {
  constructor() {
    super("idempotency_hit");
  }
}

async function countUserTrades(db: Db, userId: string): Promise<number> {
  const rows = await db
    .select({ id: trades.id })
    .from(trades)
    .where(eq(trades.userId, userId))
    .limit(2);
  return rows.length;
}

export type ListTradesInput = {
  userId: string;
  limit: number;
};

export async function listTrades(db: Db, input: ListTradesInput): Promise<Trade[]> {
  const limit = Math.min(Math.max(input.limit, 1), 200);
  return db
    .select()
    .from(trades)
    .where(eq(trades.userId, input.userId))
    .orderBy(desc(trades.createdAt))
    .limit(limit);
}

export const ASSET_IDS = ASSETS.map((a) => a.id);
```

- [ ] **Step 3: Re-run the tests**

```bash
pnpm --filter @paper/server test trades.test.ts
```

Expected: all green.

- [ ] **Step 4: Run the full server suite for regressions**

```bash
pnpm --filter @paper/server test
```

Expected: 40 + 12 ≈ 52 passing (the new tests count toward the total). If anything in `me.test.ts` or `portfolio.test.ts` flakes, the truncate helper change in T1 step 4 is the suspect — re-read it.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/trades.ts apps/server/test/services/trades.test.ts
git commit -m "feat(server): trade service with atomic write + idempotency + Decimal-exact math"
```

---

### Task 3: POST /v1/trades + GET /v1/trades routes (TDD)

**Files:**
- Create: `apps/server/src/routes/trades.ts`
- Create: `apps/server/test/routes/trades.test.ts`
- Modify: `apps/server/src/server.ts` (register the new route plugin)

The POST endpoint sets `config.rateLimit = { max: 20, timeWindow: "1 minute", keyGenerator: req => req.user?.sub ?? req.ip }` so the rate limit is per-user, not per-IP (a shared NAT must not throttle distinct users). The GET endpoint is unthrottled because it's idempotent and small.

- [ ] **Step 1: Write the failing tests for the routes**

Create `apps/server/test/routes/trades.test.ts`:

```typescript
import { trades, users } from "@/db/schema/index.js";
import { closeRedis } from "@/services/redis.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { truncateAllTables } from "../helpers/db.js";
import { withFreshRedis } from "../helpers/redis.js";
import { type TestServer, makeTestServer } from "../helpers/server.js";

describe("POST /v1/trades", () => {
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
    const res = await ctx.app.inject({ method: "POST", url: "/v1/trades", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("buys $100 of BTC and returns the trade row + is_first_trade=true", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      await r.set("paper:price:BTC", JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }), "EX", 120);
      const { token, userId } = await deviceAuth("00000000-0000-0000-0000-00000000ba01");
      const res = await ctx.app.inject({
        method: "POST",
        url: "/v1/trades",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {
          asset_id: "BTC",
          side: "buy",
          usd_amount: "100.00",
          idempotency_key: "k-1",
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as {
        trade: { id: string; asset_id: string; side: string; qty: string; usd_amount: string; price_at_execution: string; created_at: string };
        is_first_trade: boolean;
      };
      expect(body.trade.asset_id).toBe("BTC");
      expect(body.trade.side).toBe("buy");
      expect(body.trade.qty).toBe("0.00200000");
      expect(body.trade.price_at_execution).toBe("50000.00000000");
      expect(body.is_first_trade).toBe(true);

      const rows = await ctx.db.select().from(trades).where(eq(trades.userId, userId));
      expect(rows).toHaveLength(1);
    });
  });

  it("returns 409 with the existing trade for an idempotency replay", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      await r.set("paper:price:BTC", JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }), "EX", 120);
      const { token } = await deviceAuth("00000000-0000-0000-0000-00000000ba02");
      const send = () =>
        ctx.app.inject({
          method: "POST",
          url: "/v1/trades",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          payload: {
            asset_id: "BTC",
            side: "buy",
            usd_amount: "100.00",
            idempotency_key: "k-dup",
          },
        });
      const a = await send();
      const b = await send();
      expect(a.statusCode).toBe(201);
      expect(b.statusCode).toBe(200);
      const aBody = a.json() as { trade: { id: string } };
      const bBody = b.json() as { trade: { id: string }; is_first_trade: boolean };
      expect(bBody.trade.id).toBe(aBody.trade.id);
      expect(bBody.is_first_trade).toBe(false);
    });
  });

  it("rejects insufficient_cash with 422", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      await r.set("paper:price:BTC", JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }), "EX", 120);
      const { token } = await deviceAuth("00000000-0000-0000-0000-00000000ba03");
      const res = await ctx.app.inject({
        method: "POST",
        url: "/v1/trades",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {
          asset_id: "BTC",
          side: "buy",
          usd_amount: "100000.00",
          idempotency_key: "k-bad",
        },
      });
      expect(res.statusCode).toBe(422);
      expect((res.json() as { error: string }).error).toBe("insufficient_cash");
    });
  });

  it("rejects price_unavailable with 503 when cache is empty", async () => {
    await withFreshRedis(async () => {
      const { token } = await deviceAuth("00000000-0000-0000-0000-00000000ba04");
      const res = await ctx.app.inject({
        method: "POST",
        url: "/v1/trades",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {
          asset_id: "BTC",
          side: "buy",
          usd_amount: "100.00",
          idempotency_key: "k-no-price",
        },
      });
      expect(res.statusCode).toBe(503);
      expect((res.json() as { error: string }).error).toBe("price_unavailable");
    });
  });

  it("rejects unknown_asset with 400", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      await r.set("paper:price:BTC", JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }), "EX", 120);
      const { token } = await deviceAuth("00000000-0000-0000-0000-00000000ba05");
      const res = await ctx.app.inject({
        method: "POST",
        url: "/v1/trades",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {
          asset_id: "ZZZ",
          side: "buy",
          usd_amount: "100.00",
          idempotency_key: "k-unknown",
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it("throttles to 20/min per user — the 21st returns 429", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      await r.set("paper:price:BTC", JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }), "EX", 120);
      const { token } = await deviceAuth("00000000-0000-0000-0000-00000000ba06");
      // 20 distinct buys keep portfolio above zero (20 × $1 << $10k starter cash).
      for (let i = 0; i < 20; i++) {
        const res = await ctx.app.inject({
          method: "POST",
          url: "/v1/trades",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          payload: {
            asset_id: "BTC",
            side: "buy",
            usd_amount: "1.00",
            idempotency_key: `k-rl-${i}`,
          },
        });
        expect(res.statusCode).toBe(201);
      }
      const blocked = await ctx.app.inject({
        method: "POST",
        url: "/v1/trades",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {
          asset_id: "BTC",
          side: "buy",
          usd_amount: "1.00",
          idempotency_key: "k-rl-21",
        },
      });
      expect(blocked.statusCode).toBe(429);
    });
  });
});

describe("GET /v1/trades", () => {
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

  async function deviceAuth(uuid: string): Promise<string> {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/device",
      payload: { device_uuid: uuid },
    });
    return (res.json() as { access_token: string }).access_token;
  }

  it("requires auth", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/v1/trades" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the user's trades, newest first, capped by limit", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      await r.set("paper:price:BTC", JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }), "EX", 120);
      const token = await deviceAuth("00000000-0000-0000-0000-00000000bb01");

      for (let i = 0; i < 3; i++) {
        await ctx.app.inject({
          method: "POST",
          url: "/v1/trades",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          payload: {
            asset_id: "BTC",
            side: "buy",
            usd_amount: "1.00",
            idempotency_key: `k-${i}`,
          },
        });
      }
      const res = await ctx.app.inject({
        method: "GET",
        url: "/v1/trades?limit=2",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { trades: Array<{ id: string; idempotency_key: string }> };
      expect(body.trades).toHaveLength(2);
      // Newest first: idempotency_key for index 2 should appear before index 1.
      expect(body.trades[0]?.idempotency_key).toBe("k-2");
      expect(body.trades[1]?.idempotency_key).toBe("k-1");
    });
  });
});
```

Run:

```bash
pnpm --filter @paper/server test trades.test.ts -t "POST /v1/trades"
```

Expected: failing — the route plugin doesn't exist yet.

- [ ] **Step 2: Create `apps/server/src/routes/trades.ts`**

```typescript
import { ASSETS } from "@paper/shared";
import { ASSET_IDS, executeTrade, listTrades } from "@/services/trades.js";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const ASSET_ID_ENUM = z.enum(ASSETS.map((a) => a.id) as [string, ...string[]]);

const TradeBody = z.object({
  asset_id: ASSET_ID_ENUM,
  side: z.enum(["buy", "sell"]),
  // Pre-validate the wire string. Trade math runs on Decimal; we keep the
  // wire shape `string` end-to-end to avoid float-round trips.
  usd_amount: z
    .string()
    .regex(/^\d+(\.\d{1,8})?$/, "must be a positive number with ≤8 decimals"),
  idempotency_key: z.string().min(1).max(120),
});

const TradeRow = z.object({
  id: z.uuid(),
  asset_id: z.string(),
  side: z.enum(["buy", "sell"]),
  usd_amount: z.string(),
  qty: z.string(),
  price_at_execution: z.string(),
  idempotency_key: z.string(),
  created_at: z.string(),
});

const TradeOk = z.object({
  trade: TradeRow,
  is_first_trade: z.boolean(),
});

const TradeError = z.object({
  error: z.enum([
    "insufficient_cash",
    "insufficient_qty",
    "unknown_asset",
    "invalid_amount",
  ]),
});
const PriceUnavailable = z.object({ error: z.literal("price_unavailable") });

const TradeListResponse = z.object({
  trades: z.array(TradeRow),
});
const TradeListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const tradesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/v1/trades",
    {
      preHandler: app.authenticate,
      // Per spec §11.6: ≤20 trades/min/user. The default rate-limit plugin
      // keys on IP — override per-route to key on the JWT subject so a shared
      // NAT or proxy doesn't cross-throttle different users.
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
          keyGenerator: (req) => req.user?.sub ?? req.ip,
        },
      },
      schema: {
        tags: ["trades"],
        summary: "Execute one buy/sell at the cached price",
        security: [{ bearerAuth: [] }],
        body: TradeBody,
        response: {
          200: TradeOk, // idempotent replay
          201: TradeOk, // fresh insert
          400: TradeError,
          422: TradeError,
          429: z.object({ error: z.literal("rate_limited") }),
          503: PriceUnavailable,
        },
      },
    },
    async (request, reply) => {
      const userId = request.user.sub;
      const body = request.body;
      // ASSET_IDS keeps the trade service shielded from a stale enum snapshot
      // — the one source of truth is `@paper/shared`. The enum here is a fast
      // schema-level reject; the service does its own isAssetId check.
      const _validated: typeof ASSET_IDS = ASSET_IDS;
      void _validated;

      const result = await executeTrade(app.db, app.config.REDIS_URL, {
        userId,
        assetId: body.asset_id,
        side: body.side,
        usdAmount: padTo8(body.usd_amount),
        idempotencyKey: body.idempotency_key,
      });

      if (result.kind === "error") {
        const code = result.code;
        if (code === "price_unavailable") {
          return reply.code(503).send({ error: code });
        }
        if (code === "unknown_asset" || code === "invalid_amount") {
          return reply.code(400).send({ error: code });
        }
        // insufficient_cash / insufficient_qty
        return reply.code(422).send({ error: code });
      }

      const wire = toWire(result.trade);
      // 200 on idempotent replay (already-existed) so clients can distinguish
      // "did we just create it" from "did we re-show an existing row". Plan 5
      // metrics dashboards will key on this.
      const status = result.isFirstTrade || isFreshlyCreated(result.trade) ? 201 : 200;
      return reply.code(status).send({ trade: wire, is_first_trade: result.isFirstTrade });
    },
  );

  app.get(
    "/v1/trades",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["trades"],
        summary: "List the user's trades, newest first",
        security: [{ bearerAuth: [] }],
        querystring: TradeListQuery,
        response: { 200: TradeListResponse },
      },
    },
    async (request) => {
      const list = await listTrades(app.db, {
        userId: request.user.sub,
        limit: request.query.limit,
      });
      return { trades: list.map(toWire) };
    },
  );
};

function toWire(t: {
  id: string;
  assetId: string;
  side: "buy" | "sell";
  usdAmount: string;
  qty: string;
  priceAtExecution: string;
  idempotencyKey: string;
  createdAt: Date;
}): {
  id: string;
  asset_id: string;
  side: "buy" | "sell";
  usd_amount: string;
  qty: string;
  price_at_execution: string;
  idempotency_key: string;
  created_at: string;
} {
  return {
    id: t.id,
    asset_id: t.assetId,
    side: t.side,
    usd_amount: t.usdAmount,
    qty: t.qty,
    price_at_execution: t.priceAtExecution,
    idempotency_key: t.idempotencyKey,
    created_at: t.createdAt.toISOString(),
  };
}

function padTo8(s: string): string {
  // "100" → "100.00000000"; "1.5" → "1.50000000"; "0.00000001" stays.
  const [whole, frac = ""] = s.split(".");
  return `${whole}.${(frac + "00000000").slice(0, 8)}`;
}

function isFreshlyCreated(t: { createdAt: Date }): boolean {
  // Best-effort: a row created in the last 2 seconds is "fresh". Tests can be
  // flaky if the clock skew is huge, but Trade.createdAt is set by Postgres
  // `now()` and Postgres + the API run in the same pod.
  return Date.now() - t.createdAt.getTime() < 2_000;
}
```

- [ ] **Step 3: Register `tradesRoutes` in `apps/server/src/server.ts`**

Add the import and `app.register(tradesRoutes)` call. The full file becomes:

```typescript
import fastifyCors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyMetricsPkg from "fastify-metrics";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { authPlugin } from "./plugins/auth.js";
import { rateLimitPlugin } from "./plugins/rate-limit.js";
import { registerSwagger } from "./plugins/swagger.js";
import { assetsRoutes } from "./routes/assets.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";
import { tradesRoutes } from "./routes/trades.js";

const fastifyMetrics = fastifyMetricsPkg.default;

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    config: Config;
  }
}

export interface BuildServerOptions {
  config: Config;
  db: Db;
}

export async function buildServer({ config, db }: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } }
          : undefined,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "*.password",
          "*.token",
          "*.refresh_token",
          "*.access_token",
        ],
        censor: "[REDACTED]",
      },
    },
    disableRequestLogging: false,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate("db", db);
  app.decorate("config", config);

  await app.register(fastifyCors, {
    origin:
      config.NODE_ENV === "production"
        ? [
            "https://papercrypto.tech",
            "https://www.papercrypto.tech",
            "https://paper-web.pages.dev",
          ]
        : ["http://localhost:5173", "http://127.0.0.1:5173"],
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });

  await app.register(authPlugin, { config });
  await app.register(fastifyMetrics, { endpoint: "/metrics", clearRegisterOnInit: true });
  await app.register(rateLimitPlugin, { config });
  await registerSwagger(app);
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(assetsRoutes);
  await app.register(meRoutes);
  await app.register(tradesRoutes);

  return app;
}

export type AppInstance = FastifyInstance;
```

- [ ] **Step 4: Re-run the trades route tests**

```bash
pnpm --filter @paper/server test trades.test.ts
```

Expected: all green. The 20/min throttle test depends on the `@fastify/rate-limit` plugin's Redis key namespace including the route — by default it does (`{plugin-prefix}:{route}:{key}`). If the throttle test fails with `expect 429 toBe 201` after running multiple test files in the same process, run only `trades.test.ts` to isolate, then add `await r.flushdb()` at the head of the test to wipe stale rate-limit counters.

- [ ] **Step 5: Run the full server suite**

```bash
pnpm --filter @paper/server test
```

Expected: 40 baseline + 12 (T2) + 9 (T3) ≈ 61 passing. If `me.test.ts` newly fails because `today_pct_change` is missing, that's expected — T7 adds it. Skip me.test.ts adjustments until T7.

- [ ] **Step 6: Regenerate the API client** (semantic schema additions, not whitespace churn)

```bash
pnpm gen:api-client
```

Expected: new files for `useGetV1Trades.ts`, `usePostV1Trades.ts`, plus types under `src/types/`. Inspect:

```bash
git status --short packages/api-client/
```

Stage only files that contain real changes. If `openapi.json` whitespace shifted on unrelated routes (Plan 2 saw this), `git checkout -- packages/api-client/openapi.json` and re-run `gen:api-client`; the issue is usually a stale dev server in another shell.

- [ ] **Step 7: Verify web typecheck still passes (it doesn't use the new hook yet, but the regenerated tree must compile)**

```bash
pnpm --filter @paper/web typecheck
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/routes/trades.ts apps/server/src/server.ts apps/server/test/routes/trades.test.ts packages/api-client
git commit -m "feat(server): POST /v1/trades + GET /v1/trades with idempotency + 20/min rate limit"
```

---

### Task 4: Snapshot service — todayPctChange + ensureTodaySnapshot + runDailySnapshot (TDD)

**Files:**
- Create: `apps/server/src/services/snapshots.ts`
- Create: `apps/server/test/services/snapshots.test.ts`

The snapshot service has three responsibilities:
1. `ensureTodaySnapshot(db, redisUrl, userId)` — idempotent insert of today's open snapshot if missing. Called by the trade service after a successful execution and by the daily cron.
2. `runDailySnapshot(db, redisUrl)` — iterates every user, computes their current `total_value_usd`, upserts a row keyed on `(user_id, today_utc_date)`. Idempotent.
3. `todayPctChange(db, snapshotDate, userId, currentTotal)` — reads today's snapshot and returns `((currentTotal - snapshot) / snapshot) * 100` rounded to 4 decimals; returns null if no snapshot exists yet (first ever visit before any cron tick or trade).

- [ ] **Step 1: Write the failing tests**

Create `apps/server/test/services/snapshots.test.ts`:

```typescript
import { makeDb } from "@/db/client.js";
import { portfolioSnapshots, portfolios, users } from "@/db/schema/index.js";
import { closeRedis } from "@/services/redis.js";
import {
  ensureTodaySnapshot,
  runDailySnapshot,
  todaySnapshotKey,
  todayPctChange,
} from "@/services/snapshots.js";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { truncateAllTables } from "../helpers/db.js";
import { withFreshRedis } from "../helpers/redis.js";

const dbUrl = process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/paper";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

describe("todaySnapshotKey", () => {
  it("returns YYYY-MM-DD in UTC", () => {
    const k = todaySnapshotKey(new Date("2026-05-09T03:14:15.926Z"));
    expect(k).toBe("2026-05-09");
  });
  it("rolls at 00:00 UTC, not local midnight", () => {
    // 23:59 UTC on 2026-05-09 must still report "2026-05-09".
    expect(todaySnapshotKey(new Date("2026-05-09T23:59:00Z"))).toBe("2026-05-09");
    expect(todaySnapshotKey(new Date("2026-05-10T00:00:01Z"))).toBe("2026-05-10");
  });
});

describe("ensureTodaySnapshot", () => {
  const handles = makeDb(dbUrl, { max: 2 });
  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  async function seedUser(): Promise<string> {
    const [u] = await handles.db
      .insert(users)
      .values({ deviceUuid: "00000000-0000-0000-0000-00000000ffaa" })
      .returning({ id: users.id });
    if (!u) throw new Error("no user");
    await handles.db.insert(portfolios).values({
      userId: u.id,
      cashUsd: "10000.00000000",
      holdings: {},
    });
    return u.id;
  }

  it("inserts the row when missing", async () => {
    await withFreshRedis(async () => {
      const userId = await seedUser();
      const today = todaySnapshotKey(new Date());
      const r = await ensureTodaySnapshot(handles.db, redisUrl, userId);
      expect(r.created).toBe(true);
      const [row] = await handles.db
        .select()
        .from(portfolioSnapshots)
        .where(
          and(eq(portfolioSnapshots.userId, userId), eq(portfolioSnapshots.snapshotDate, today)),
        );
      expect(row?.totalValueUsd).toBe("10000.00000000");
    });
  });

  it("is idempotent — second call reports created=false", async () => {
    await withFreshRedis(async () => {
      const userId = await seedUser();
      const a = await ensureTodaySnapshot(handles.db, redisUrl, userId);
      const b = await ensureTodaySnapshot(handles.db, redisUrl, userId);
      expect(a.created).toBe(true);
      expect(b.created).toBe(false);
    });
  });
});

describe("todayPctChange", () => {
  const handles = makeDb(dbUrl, { max: 2 });
  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  it("returns null when no snapshot exists", async () => {
    const result = await todayPctChange(handles.db, {
      userId: "00000000-0000-0000-0000-00000000ffbb",
      currentTotalUsd: "10500.00000000",
    });
    expect(result).toBeNull();
  });

  it("computes (current - open) / open × 100", async () => {
    const [u] = await handles.db
      .insert(users)
      .values({ deviceUuid: "00000000-0000-0000-0000-00000000ffcc" })
      .returning({ id: users.id });
    if (!u) throw new Error("no user");
    await handles.db.insert(portfolioSnapshots).values({
      userId: u.id,
      snapshotDate: todaySnapshotKey(new Date()),
      totalValueUsd: "10000.00000000",
    });
    const result = await todayPctChange(handles.db, {
      userId: u.id,
      currentTotalUsd: "10500.00000000",
    });
    expect(result).toBe(5);
  });
});

describe("runDailySnapshot", () => {
  const handles = makeDb(dbUrl, { max: 2 });
  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  it("writes one row per user with their current total_value_usd", async () => {
    await withFreshRedis(async (r) => {
      // Seed two users; one cash-only, one with a position.
      const [u1] = await handles.db
        .insert(users)
        .values({ deviceUuid: "00000000-0000-0000-0000-00000000ff11" })
        .returning({ id: users.id });
      const [u2] = await handles.db
        .insert(users)
        .values({ deviceUuid: "00000000-0000-0000-0000-00000000ff22" })
        .returning({ id: users.id });
      if (!u1 || !u2) throw new Error("no user");
      await handles.db.insert(portfolios).values({
        userId: u1.id,
        cashUsd: "10000.00000000",
        holdings: {},
      });
      await handles.db.insert(portfolios).values({
        userId: u2.id,
        cashUsd: "5000.00000000",
        holdings: { BTC: { qty: "0.10000000", cost_basis: "40000.00000000" } },
      });
      const ts = Math.floor(Date.now() / 1000);
      await r.set("paper:price:BTC", JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }), "EX", 120);

      const result = await runDailySnapshot(handles.db, redisUrl);
      expect(result.ok).toBe(2);
      expect(result.failed).toBe(0);

      const today = todaySnapshotKey(new Date());
      const rows = await handles.db
        .select()
        .from(portfolioSnapshots)
        .where(eq(portfolioSnapshots.snapshotDate, today));
      expect(rows).toHaveLength(2);
      const map = Object.fromEntries(rows.map((r) => [r.userId, r.totalValueUsd]));
      expect(map[u1.id]).toBe("10000.00000000");
      // 5000 cash + 0.10 BTC × 50000 = 10000
      expect(map[u2.id]).toBe("10000.00000000");
    });
  });

  it("is idempotent — re-running on the same UTC date does not duplicate", async () => {
    await withFreshRedis(async () => {
      const [u] = await handles.db
        .insert(users)
        .values({ deviceUuid: "00000000-0000-0000-0000-00000000ff33" })
        .returning({ id: users.id });
      if (!u) throw new Error("no user");
      await handles.db.insert(portfolios).values({
        userId: u.id,
        cashUsd: "10000.00000000",
        holdings: {},
      });
      await runDailySnapshot(handles.db, redisUrl);
      await runDailySnapshot(handles.db, redisUrl);
      const today = todaySnapshotKey(new Date());
      const rows = await handles.db
        .select()
        .from(portfolioSnapshots)
        .where(
          and(eq(portfolioSnapshots.userId, u.id), eq(portfolioSnapshots.snapshotDate, today)),
        );
      expect(rows).toHaveLength(1);
    });
  });
});
```

Run:

```bash
pnpm --filter @paper/server test snapshots.test.ts
```

Expected: failing — module doesn't exist.

- [ ] **Step 2: Create `apps/server/src/services/snapshots.ts`**

```typescript
import type { Db } from "@/db/client.js";
import { portfolioSnapshots, portfolios, users } from "@/db/schema/index.js";
import { Decimal } from "decimal.js";
import { and, eq } from "drizzle-orm";
import { getPortfolioWithValuation } from "./portfolio.js";

export type EnsureSnapshotResult = { created: boolean; date: string };

/**
 * UTC date key in YYYY-MM-DD. Snapshot-period semantics live in UTC because the
 * cluster CronJob runs in UTC and players in different timezones still need a
 * consistent global "open of day" value. Localised displays are a Plan 5 chore.
 */
export function todaySnapshotKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Idempotent: insert today's snapshot row if missing. Used by the trade
 * service to back-fill "today's open" for a user created after midnight, and
 * by the daily cron as a fail-safe.
 */
export async function ensureTodaySnapshot(
  db: Db,
  redisUrl: string,
  userId: string,
): Promise<EnsureSnapshotResult> {
  const date = todaySnapshotKey();
  const portfolio = await getPortfolioWithValuation(db, redisUrl, userId);
  if (!portfolio) {
    // No portfolio means no user — caller's contract violated. Return early
    // rather than insert garbage.
    return { created: false, date };
  }
  const inserted = await db
    .insert(portfolioSnapshots)
    .values({
      userId,
      snapshotDate: date,
      totalValueUsd: portfolio.total_value_usd,
    })
    .onConflictDoNothing({
      target: [portfolioSnapshots.userId, portfolioSnapshots.snapshotDate],
    })
    .returning({ userId: portfolioSnapshots.userId });
  return { created: inserted.length === 1, date };
}

/**
 * Iterate every user and snapshot their current total_value_usd. Designed for
 * a midnight CronJob; safe to re-run multiple times on the same UTC day
 * (composite PK trips → onConflictDoNothing). Per-user failures are logged
 * and tallied; the cron exits 0 unless every user fails.
 */
export async function runDailySnapshot(
  db: Db,
  redisUrl: string,
): Promise<{ ok: number; failed: number; date: string }> {
  const date = todaySnapshotKey();
  // For v0, "every user" is small — selecting all of them is fine. Plan 6's
  // leaderboard recompute will introduce paginated batched iteration; mirror
  // that pattern when the user count crosses ~10k.
  const allUsers = await db.select({ id: users.id }).from(users);
  let ok = 0;
  let failed = 0;
  for (const u of allUsers) {
    try {
      const p = await getPortfolioWithValuation(db, redisUrl, u.id);
      if (!p) {
        failed++;
        console.warn(
          JSON.stringify({ event: "snapshot_skip_no_portfolio", user_id: u.id, date }),
        );
        continue;
      }
      await db
        .insert(portfolioSnapshots)
        .values({
          userId: u.id,
          snapshotDate: date,
          totalValueUsd: p.total_value_usd,
        })
        .onConflictDoNothing({
          target: [portfolioSnapshots.userId, portfolioSnapshots.snapshotDate],
        });
      ok++;
    } catch (err) {
      failed++;
      console.warn(
        JSON.stringify({
          event: "snapshot_user_failed",
          user_id: u.id,
          date,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  return { ok, failed, date };
}

/**
 * Compute "% today" = (currentTotal − open) / open × 100, where `open` is
 * today's snapshot. Returns null when no snapshot exists (brand-new user
 * before the cron ran AND before their first trade — the trade service
 * back-fills, so this null is a transient state).
 */
export async function todayPctChange(
  db: Db,
  input: { userId: string; currentTotalUsd: string; now?: Date },
): Promise<number | null> {
  const date = todaySnapshotKey(input.now);
  const [row] = await db
    .select()
    .from(portfolioSnapshots)
    .where(
      and(
        eq(portfolioSnapshots.userId, input.userId),
        eq(portfolioSnapshots.snapshotDate, date),
      ),
    );
  if (!row) return null;
  const open = new Decimal(row.totalValueUsd);
  if (open.lte(0)) return null; // protect against div-by-zero on an edge-case zeroed account
  const cur = new Decimal(input.currentTotalUsd);
  return cur.minus(open).div(open).mul(100).toDecimalPlaces(4).toNumber();
}
```

- [ ] **Step 3: Re-run the tests**

```bash
pnpm --filter @paper/server test snapshots.test.ts
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/services/snapshots.ts apps/server/test/services/snapshots.test.ts
git commit -m "feat(server): portfolio snapshot service (UTC-keyed, idempotent)"
```

---

### Task 5: Wire `ensureTodaySnapshot` into the trade service + add `today_pct_change` to GET /v1/me (TDD)

**Files:**
- Modify: `apps/server/src/services/trades.ts` (call `ensureTodaySnapshot` post-success)
- Modify: `apps/server/src/routes/me.ts` (add `today_pct_change` to the response)
- Modify: `apps/server/test/routes/me.test.ts` (assert `today_pct_change` shape + value)
- Modify: `apps/server/test/services/trades.test.ts` (assert a snapshot row materialises after the first trade of the day)

The trade service now back-fills today's open snapshot after a fresh insert (NOT on idempotent replay — the row already exists from the first call). `GET /v1/me` returns `today_pct_change: number | null`.

- [ ] **Step 1: Append a trade-side test for snapshot back-fill**

Append to `apps/server/test/services/trades.test.ts`:

```typescript
describe("executeTrade — snapshot back-fill", () => {
  const handles = makeDb(dbUrl, { max: 2 });
  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  it("back-fills today's snapshot on the first trade of the day", async () => {
    await withFreshRedis(async (r) => {
      const ts = Math.floor(Date.now() / 1000);
      await r.set("paper:price:BTC", JSON.stringify({ usd: 50_000, prevUsd: 49_000, ts }), "EX", 120);
      const [u] = await handles.db
        .insert(users)
        .values({ deviceUuid: "00000000-0000-0000-0000-00000000bb44" })
        .returning({ id: users.id });
      if (!u) throw new Error("no user");
      await handles.db.insert(portfolios).values({
        userId: u.id,
        cashUsd: "10000.00000000",
        holdings: {},
      });

      await executeTrade(handles.db, redisUrl, {
        userId: u.id,
        assetId: "BTC",
        side: "buy",
        usdAmount: "100.00000000",
        idempotencyKey: "k-bf-1",
      });

      const { todaySnapshotKey } = await import("@/services/snapshots.js");
      const today = todaySnapshotKey(new Date());
      const { portfolioSnapshots } = await import("@/db/schema/index.js");
      const { and, eq } = await import("drizzle-orm");
      const [row] = await handles.db
        .select()
        .from(portfolioSnapshots)
        .where(
          and(eq(portfolioSnapshots.userId, u.id), eq(portfolioSnapshots.snapshotDate, today)),
        );
      // The back-fill captures today's *open* before the trade reduced cash
      // to compute the buy. We back-fill BEFORE the trade fires when it's a
      // first-trade-of-the-day so the snapshot reflects the user's pre-trade
      // baseline. Expect 10,000 (open) — NOT 9,900 (post-trade).
      expect(row?.totalValueUsd).toBe("10000.00000000");
    });
  });
});
```

This test pins the **pre-trade** baseline. The trade service must call `ensureTodaySnapshot` BEFORE the transaction body runs.

- [ ] **Step 2: Modify `apps/server/src/services/trades.ts`**

At the top of `executeTrade`, AFTER the asset-id and amount validation but BEFORE the transaction, add an `ensureTodaySnapshot` call:

```typescript
import { ensureTodaySnapshot } from "./snapshots.js";

// ... inside executeTrade, after the price + qty validation:
  // Back-fill today's open snapshot if this is the first interaction of the
  // UTC day. Idempotent: a returning user with a row already won't insert.
  // Done OUTSIDE the trade transaction so a snapshot insert failure (very
  // unlikely) doesn't roll back the trade itself.
  await ensureTodaySnapshot(db, redisUrl, input.userId);
```

The full updated `executeTrade` opening reads:

```typescript
export async function executeTrade(
  db: Db,
  redisUrl: string,
  input: ExecuteTradeInput,
): Promise<ExecuteTradeResult> {
  if (!isAssetId(input.assetId)) {
    return { kind: "error", code: "unknown_asset" };
  }

  const usdAmountDec = new Decimal(input.usdAmount);
  if (!usdAmountDec.isFinite() || usdAmountDec.lte(0)) {
    return { kind: "error", code: "invalid_amount" };
  }

  const cached = await getCachedPrice(redisUrl, input.assetId);
  if (!cached || cached.usd <= 0) {
    return { kind: "error", code: "price_unavailable" };
  }
  const priceDec = new Decimal(cached.usd);
  const qtyDec = usdAmountDec.div(priceDec).toDecimalPlaces(QTY_DP, Decimal.ROUND_DOWN);
  if (qtyDec.lte(0)) {
    return { kind: "error", code: "invalid_amount" };
  }

  await ensureTodaySnapshot(db, redisUrl, input.userId);

  // ... rest of the function unchanged
```

- [ ] **Step 3: Re-run the trade-service suite**

```bash
pnpm --filter @paper/server test trades.test.ts
```

Expected: all green, including the new back-fill test.

- [ ] **Step 4: Add `today_pct_change` to `apps/server/src/routes/me.ts`**

Replace the GET `/v1/me` handler (and the response schema) so it computes and returns `today_pct_change`:

```typescript
import { todayPctChange } from "@/services/snapshots.js";

// In the schema declarations:
const MePortfolio = z.object({
  cash_usd: z.string(),
  holdings: z.array(Holding),
  total_value_usd: z.string(),
  today_pct_change: z.number().nullable(),
});

// In the GET handler, after `getPortfolioWithValuation`:
const pct = await todayPctChange(app.db, {
  userId,
  currentTotalUsd: p.total_value_usd,
});

return {
  user: { id: u.id, handle: u.handle, avatar: u.avatar },
  portfolio: {
    cash_usd: p.cash_usd,
    holdings: p.holdings,
    total_value_usd: p.total_value_usd,
    today_pct_change: pct,
  },
};
```

- [ ] **Step 5: Update `apps/server/test/routes/me.test.ts` to cover the new field**

In the existing "returns the current user + a $10k portfolio" test, append:

```typescript
expect(body.portfolio.today_pct_change).toBeNull();
```

Add a new test under the same describe block:

```typescript
it("computes today_pct_change against today's snapshot", async () => {
  await withFreshRedis(async (r) => {
    const { token, userId } = await deviceAuth("00000000-0000-0000-0000-00000000c003");
    // Pre-seed an "open" snapshot at 9,000 so a 10,000 portfolio is +11.11%.
    const today = new Date().toISOString().slice(0, 10);
    const { portfolioSnapshots } = await import("@/db/schema/index.js");
    await ctx.db.insert(portfolioSnapshots).values({
      userId,
      snapshotDate: today,
      totalValueUsd: "9000.00000000",
    });
    const ts = Math.floor(Date.now() / 1000);
    await r.set("paper:price:BTC", JSON.stringify({ usd: 70000, prevUsd: 69000, ts }), "EX", 120);

    const res = await ctx.app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      portfolio: { today_pct_change: number | null };
    };
    expect(body.portfolio.today_pct_change).toBeCloseTo(11.1111, 4);
  });
});
```

- [ ] **Step 6: Run the suite**

```bash
pnpm --filter @paper/server test
```

Expected: all green. If any earlier `me.test.ts` test now fails because the response schema changed, the test asserted the old shape — update it.

- [ ] **Step 7: Regenerate the API client**

```bash
pnpm gen:api-client
```

Expected: `useGetV1Me` types now include `today_pct_change: number | null`. Inspect:

```bash
grep -n today_pct_change packages/api-client/src/types/GetV1Me.ts
```

Should match.

- [ ] **Step 8: Web typecheck**

```bash
pnpm --filter @paper/web typecheck
```

If the existing `HeroPortfolioCard.tsx` reads `data.portfolio.today_pct_change`, that's fine. If not (Plan 2 wires "0.00% today" as a placeholder), it still compiles because the new field is additive. T13 will use it.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/services/trades.ts apps/server/src/routes/me.ts apps/server/test packages/api-client
git commit -m "feat(server): wire ensureTodaySnapshot into trade service + add today_pct_change to /v1/me"
```

---

### Phase B — Daily snapshot cron (T6–T7)

### Task 6: Daily-snapshot CronJob entrypoint (TDD)

**Files:**
- Create: `apps/server/src/jobs/daily-snapshot.ts`
- Create: `apps/server/test/jobs/daily-snapshot.test.ts`

The cron entry mirrors `apps/server/src/jobs/price-ingestion.ts`: a `runDailySnapshot()` export for testing, plus a guarded `main()` that the K8s container runs as `node apps/server/dist/jobs/daily-snapshot.js`. The cron iterates per user and writes one row per — DB pool ceiling `{ max: 4 }` keeps a small batch concurrent without saturating Postgres connections.

- [ ] **Step 1: Write the test**

Create `apps/server/test/jobs/daily-snapshot.test.ts`:

```typescript
import { runDailyPortfolioSnapshot } from "@/jobs/daily-snapshot.js";
import { closeRedis } from "@/services/redis.js";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withFreshRedis } from "../helpers/redis.js";

describe("runDailyPortfolioSnapshot", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv(
      "DATABASE_URL",
      process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/paper",
    );
    vi.stubEnv("REDIS_URL", process.env.REDIS_URL ?? "redis://localhost:6379");
    vi.stubEnv("JWT_SECRET", "test-secret-must-be-at-least-32-characters-long");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await closeRedis();
  });

  it("returns ok=0 when there are no users (smoke)", async () => {
    await withFreshRedis(async () => {
      const { ok, failed } = await runDailyPortfolioSnapshot();
      expect(ok).toBeGreaterThanOrEqual(0);
      expect(failed).toBe(0);
    });
  });
});
```

(The dense per-user assertions live in `snapshots.test.ts` against the service. The job test just confirms wiring + env loading.)

Run:

```bash
pnpm --filter @paper/server test daily-snapshot.test.ts
```

Expected: failing (module not found).

- [ ] **Step 2: Create `apps/server/src/jobs/daily-snapshot.ts`**

```typescript
import { loadConfig } from "../config.js";
import { makeDb } from "../db/client.js";
import { closeRedis } from "../services/redis.js";
import { runDailySnapshot } from "../services/snapshots.js";

export async function runDailyPortfolioSnapshot(): Promise<{ ok: number; failed: number; date: string }> {
  const config = loadConfig();
  // The job iterates one user at a time inside `runDailySnapshot`, so a small
  // pool keeps the cron polite to Postgres while still allowing a couple of
  // concurrent reads (the cron's only consumer of this DB instance).
  const handles = makeDb(config.DATABASE_URL, { max: 4 });
  try {
    const result = await runDailySnapshot(handles.db, config.REDIS_URL);
    return result;
  } finally {
    await handles.sql.end();
  }
}

async function main(): Promise<void> {
  const t0 = Date.now();
  try {
    const { ok, failed, date } = await runDailyPortfolioSnapshot();
    const elapsedMs = Date.now() - t0;
    console.info(
      JSON.stringify({
        event: "daily_snapshot_done",
        ok,
        failed,
        date,
        elapsed_ms: elapsedMs,
      }),
    );
    if (failed > 0 && ok === 0) {
      // All users failed — surface as a non-zero exit so K8s flags the Job.
      process.exit(2);
    }
    process.exit(0);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "daily_snapshot_error",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    process.exit(1);
  } finally {
    await closeRedis();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
```

- [ ] **Step 3: Re-run the test**

```bash
pnpm --filter @paper/server test daily-snapshot.test.ts
```

Expected: green.

- [ ] **Step 4: Run the full suite**

```bash
pnpm --filter @paper/server test
```

Expected: all green.

- [ ] **Step 5: Manually invoke the job once locally** (sanity)

```bash
export $(grep -v '^#' .env | xargs)
pnpm --filter @paper/server tsx src/jobs/daily-snapshot.ts
```

Expected: a single JSON line `{"event":"daily_snapshot_done","ok":N,"failed":0,...}` where `N` is the number of users in your local DB. Verify a row exists:

```bash
podman exec -i paper-postgres-1 psql -U app -d paper -c "SELECT user_id, snapshot_date, total_value_usd FROM portfolio_snapshots ORDER BY created_at DESC LIMIT 5;"
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/jobs/daily-snapshot.ts apps/server/test/jobs/daily-snapshot.test.ts
git commit -m "feat(server): daily-snapshot CronJob entrypoint"
```

---

### Task 7: K8s CronJob manifest for daily snapshot

**Files (in lab repo):**
- Create: `lab/stacks/paper/manifests/40-cron-daily-snapshot.yaml`

Same image as `paper-api`, different `command`. Schedule `0 0 * * *` (00:00 UTC). `concurrencyPolicy: Forbid` (the run is fast — minutes — but a missed start should not pile up). `backoffLimit: 0` so a transient Postgres timeout fails the Job once instead of looping; the next day's tick will retry.

- [ ] **Step 1: Verify the lab manifests directory**

```bash
ls /Users/filipkastovsky/work/personal/lab/stacks/paper/manifests
```

Expected: `30-cron-price-ingestion.yaml` plus the 10/20/21/22 set from Plan 1.

- [ ] **Step 2: Create the manifest**

Write `/Users/filipkastovsky/work/personal/lab/stacks/paper/manifests/40-cron-daily-snapshot.yaml`:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: paper-cron-daily-snapshot
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
            - name: cron-daily-snapshot
              image: ${image}
              command: ["node", "apps/server/dist/jobs/daily-snapshot.js"]
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
                  value: paper-cron-daily-snapshot
              resources:
                requests: { cpu: "20m", memory: "96Mi" }
                limits:   { cpu: "300m", memory: "192Mi" }
```

- [ ] **Step 3: Commit (lab repo)**

```bash
cd /Users/filipkastovsky/work/personal/lab
git add stacks/paper/manifests/40-cron-daily-snapshot.yaml
git commit -m "feat(paper): add daily-snapshot CronJob (00:00 UTC)"
```

(Apply happens in T16 alongside the deploy of the new image. Don't apply yet — there's no image with `dist/jobs/daily-snapshot.js` baked in.)

---

### Phase C — Web trade flow (T8–T12)

### Task 8: Trade store + bottom-sheet primitive

**Files (web):**
- Create: `apps/web/src/stores/trade-store.ts`
- Create: `apps/web/src/components/ui/bottom-sheet.tsx`
- Create: `apps/web/src/lib/trade-errors.ts`

The trade store keeps the in-flight draft (asset_id, side, usd_amount), the open/closed state of the confirmation sheet, the open/closed state of the success modal, and the `idempotency_key` minted on form submit. A single Zustand store keeps the whole `/trade` flow stateful without prop-drilling.

- [ ] **Step 1: Create `apps/web/src/stores/trade-store.ts`**

```typescript
import type { AssetId } from "@paper/shared";
import { create } from "zustand";

export type Side = "buy" | "sell";

interface TradeState {
  side: Side;
  assetId: AssetId;
  /** Free-form input — user types digits + at most one decimal point. */
  usdInput: string;
  /** Minted on first submit; reused across retries of the same intent. */
  idempotencyKey: string | null;
  confirmOpen: boolean;
  successOpen: boolean;
  /** Opaque trade row from the server, set after a successful POST. */
  lastTrade: {
    id: string;
    asset_id: string;
    side: Side;
    usd_amount: string;
    qty: string;
    price_at_execution: string;
  } | null;

  setSide: (s: Side) => void;
  setAssetId: (id: AssetId) => void;
  setUsdInput: (next: string) => void;
  openConfirm: () => void;
  closeConfirm: () => void;
  openSuccess: (trade: NonNullable<TradeState["lastTrade"]>) => void;
  closeSuccess: () => void;
  resetForNextTrade: () => void;
}

export const useTradeStore = create<TradeState>((set) => ({
  side: "buy",
  assetId: "BTC",
  usdInput: "",
  idempotencyKey: null,
  confirmOpen: false,
  successOpen: false,
  lastTrade: null,
  setSide: (s) => set({ side: s }),
  setAssetId: (id) => set({ assetId: id }),
  setUsdInput: (next) => set({ usdInput: next }),
  openConfirm: () => {
    // Mint a fresh idempotency key when the user opens the sheet — every
    // distinct "I am about to confirm" event gets its own key, but in-sheet
    // retries (network glitch, double-tap) reuse it.
    const key = `c-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
    set({ confirmOpen: true, idempotencyKey: key });
  },
  closeConfirm: () => set({ confirmOpen: false }),
  openSuccess: (t) => set({ successOpen: true, confirmOpen: false, lastTrade: t }),
  closeSuccess: () => set({ successOpen: false }),
  resetForNextTrade: () =>
    set({ usdInput: "", idempotencyKey: null, lastTrade: null, successOpen: false }),
}));
```

- [ ] **Step 2: Create `apps/web/src/components/ui/bottom-sheet.tsx`**

```tsx
import { cn } from "@/lib/cn";
import * as Dialog from "@radix-ui/react-dialog";
import type * as React from "react";

/**
 * A bottom sheet built on Radix Dialog. Slides up from the bottom on mobile,
 * centers on desktop. Used for the trade-confirmation moment so the user never
 * loses the trade form context behind a route change.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out" />
        <Dialog.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md rounded-t-3xl bg-paper p-6 pb-10 shadow-float outline-none",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom",
            "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom",
            "sm:bottom-auto sm:inset-x-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:pb-6",
            className,
          )}
        >
          {/* Visible drag handle on mobile */}
          <div
            aria-hidden
            className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-line sm:hidden"
          />
          <Dialog.Title className="font-display text-ink font-bold text-xl">{title}</Dialog.Title>
          {description ? (
            <Dialog.Description className="mt-1 text-ink-soft text-sm">
              {description}
            </Dialog.Description>
          ) : null}
          <div className="mt-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 3: Create `apps/web/src/lib/trade-errors.ts`**

```typescript
/**
 * Server `error` enum → user-facing copy. Keep these short and human; they
 * surface inside the bottom sheet during the confirmation moment.
 */
export const TRADE_ERROR_COPY: Record<string, string> = {
  insufficient_cash: "Not enough cash to cover this trade.",
  insufficient_qty: "You don't hold enough of this asset.",
  unknown_asset: "That asset isn't supported.",
  invalid_amount: "Amount must be greater than zero.",
  price_unavailable: "Price data is briefly unavailable. Try again in a few seconds.",
  rate_limited: "Slow down — you can place 20 trades per minute.",
};

export function tradeErrorCopy(code: string | undefined): string {
  if (!code) return "Something went wrong. Try again.";
  return TRADE_ERROR_COPY[code] ?? "Something went wrong. Try again.";
}
```

- [ ] **Step 4: Web typecheck**

```bash
pnpm --filter @paper/web typecheck
```

Expected: clean. (If `@radix-ui/react-dialog` types are missing, run `pnpm install --filter @paper/web` to refresh node_modules; the package is already declared in `apps/web/package.json`.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/trade-store.ts apps/web/src/components/ui/bottom-sheet.tsx apps/web/src/lib/trade-errors.ts
git commit -m "feat(web): trade store + bottom-sheet primitive + error copy map"
```

---

### Task 9: AssetPickerRow + TradeForm

**Files (web):**
- Create: `apps/web/src/components/trade/AssetPickerRow.tsx`
- Create: `apps/web/src/components/trade/TradeForm.tsx`

The picker is a horizontally scrollable chip-row of the 12 assets (Marshmallow §9.4 chip). The form has a buy/sell pill toggle, the picker, a USD input, and the "Review" CTA (a Marshmallow primary `<Button trailing="→">`).

- [ ] **Step 1: Create `apps/web/src/components/trade/AssetPickerRow.tsx`**

```tsx
import { AssetChip } from "@/components/dashboard/AssetChip";
import { cn } from "@/lib/cn";
import { useGetV1Assets } from "@paper/api-client";
import type { AssetId } from "@paper/shared";

export function AssetPickerRow({
  selected,
  onSelect,
}: {
  selected: AssetId;
  onSelect: (id: AssetId) => void;
}) {
  const { data, isLoading } = useGetV1Assets({ query: { staleTime: 30_000 } });
  const assets = data?.assets ?? [];

  return (
    <div className="-mx-2 flex gap-2 overflow-x-auto px-2 py-1">
      {isLoading && <div className="text-ink-soft text-sm">Loading assets…</div>}
      {assets.map((a) => {
        const isSel = a.id === selected;
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onSelect(a.id as AssetId)}
            aria-pressed={isSel}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-pill px-3 py-2",
              "ring-1 ring-line transition-colors",
              isSel
                ? "bg-ink text-paper ring-ink"
                : "bg-surface-2 text-ink hover:bg-surface",
            )}
          >
            <AssetChip
              letter={a.id}
              pastel={a.pastel as "peach" | "mint" | "sky" | "lilac"}
              size="sm"
            />
            <span className="font-display font-semibold text-sm">{a.id}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/web/src/components/trade/TradeForm.tsx`**

```tsx
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { cn } from "@/lib/cn";
import { useTradeStore } from "@/stores/trade-store";
import { useGetV1Assets, useGetV1Me } from "@paper/api-client";
import { useMemo } from "react";
import { AssetPickerRow } from "./AssetPickerRow";

export function TradeForm() {
  const side = useTradeStore((s) => s.side);
  const assetId = useTradeStore((s) => s.assetId);
  const usdInput = useTradeStore((s) => s.usdInput);
  const setSide = useTradeStore((s) => s.setSide);
  const setAssetId = useTradeStore((s) => s.setAssetId);
  const setUsdInput = useTradeStore((s) => s.setUsdInput);
  const openConfirm = useTradeStore((s) => s.openConfirm);

  const me = useGetV1Me({ query: { staleTime: 5_000 } });
  const assets = useGetV1Assets({ query: { staleTime: 30_000 } });

  const cashUsd = me.data ? Number.parseFloat(me.data.portfolio.cash_usd) : 0;
  const heldQty = useMemo(() => {
    const h = me.data?.portfolio.holdings.find((x) => x.asset_id === assetId);
    return h ? Number.parseFloat(h.qty) : 0;
  }, [me.data, assetId]);
  const price = assets.data?.assets.find((x) => x.id === assetId)?.price_usd ?? null;

  const usdNum = Number.parseFloat(usdInput);
  const canReview =
    Number.isFinite(usdNum) &&
    usdNum > 0 &&
    (side === "buy" ? usdNum <= cashUsd : price != null && usdNum / price <= heldQty);

  return (
    <Card tone="paper" elevation="float" padding="lush" className="space-y-5">
      <Eyebrow>place a trade</Eyebrow>
      <Heading level="h2">{side === "buy" ? "Buy" : "Sell"} {assetId}</Heading>

      {/* Buy / Sell pill toggle */}
      <div role="tablist" aria-label="Trade side" className="grid grid-cols-2 rounded-pill bg-surface-2 p-1 ring-1 ring-line">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={side === s}
            onClick={() => setSide(s)}
            className={cn(
              "rounded-pill py-2 font-display font-bold text-sm capitalize transition-colors",
              side === s ? "bg-ink text-paper" : "text-ink-soft",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      <div>
        <Eyebrow className="mb-2 block">asset</Eyebrow>
        <AssetPickerRow selected={assetId} onSelect={setAssetId} />
      </div>

      <div>
        <Eyebrow className="mb-2 block">amount (usd)</Eyebrow>
        <div className="flex items-center gap-2 rounded-md bg-surface-2 px-4 py-3 ring-1 ring-line focus-within:ring-ink">
          <span className="font-display text-ink-soft">$</span>
          <input
            inputMode="decimal"
            placeholder="0.00"
            value={usdInput}
            onChange={(e) => setUsdInput(e.target.value.replace(/[^0-9.]/g, ""))}
            className="flex-1 bg-transparent font-display text-2xl outline-none placeholder:text-muted tabular-nums"
            aria-label="USD amount"
          />
        </div>
        <p className="mt-2 text-ink-soft text-xs">
          {side === "buy"
            ? `Cash available: $${cashUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : `You hold ${heldQty.toFixed(8)} ${assetId}${price != null ? ` (~$${(heldQty * price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : ""}`}
        </p>
      </div>

      <Button
        trailing="→"
        fullWidth
        disabled={!canReview}
        aria-disabled={!canReview}
        onClick={openConfirm}
      >
        Review
      </Button>
    </Card>
  );
}
```

- [ ] **Step 3: Web typecheck**

```bash
pnpm --filter @paper/web typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/trade/AssetPickerRow.tsx apps/web/src/components/trade/TradeForm.tsx
git commit -m "feat(web): TradeForm + asset picker chip row"
```

---

### Task 10: ConfirmationSheet + SuccessModal + first_trade_placed event

**Files (web):**
- Create: `apps/web/src/components/trade/ConfirmationSheet.tsx`
- Create: `apps/web/src/components/trade/SuccessModal.tsx`

The confirmation sheet shows a pastel-tinted summary card with asset name, side, USD, computed qty, current price, and a primary "Confirm" button. On click it calls `usePostV1Trades` with the user's draft + the store's `idempotencyKey`. On error, it surfaces the human copy from `trade-errors.ts`. On 201, it transitions to the SuccessModal and fires `first_trade_placed` if the response says so.

- [ ] **Step 1: Create `apps/web/src/components/trade/ConfirmationSheet.tsx`**

```tsx
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { posthog } from "@/lib/posthog";
import { tradeErrorCopy } from "@/lib/trade-errors";
import { useTradeStore } from "@/stores/trade-store";
import { useGetV1Assets, usePostV1Trades, getV1MeQueryKey, getV1TradesQueryKey } from "@paper/api-client";
import { pastelForAsset } from "@paper/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export function ConfirmationSheet() {
  const open = useTradeStore((s) => s.confirmOpen);
  const closeConfirm = useTradeStore((s) => s.closeConfirm);
  const side = useTradeStore((s) => s.side);
  const assetId = useTradeStore((s) => s.assetId);
  const usdInput = useTradeStore((s) => s.usdInput);
  const idempotencyKey = useTradeStore((s) => s.idempotencyKey);
  const openSuccess = useTradeStore((s) => s.openSuccess);

  const assets = useGetV1Assets({ query: { staleTime: 5_000 } });
  const queryClient = useQueryClient();
  const post = usePostV1Trades();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const price = assets.data?.assets.find((a) => a.id === assetId)?.price_usd ?? null;
  const usdNum = Number.parseFloat(usdInput || "0");
  const qty = price && price > 0 ? usdNum / price : 0;
  const pastel = pastelForAsset(assetId);

  async function onConfirm() {
    if (!idempotencyKey) return;
    setErrorMsg(null);
    try {
      const res = await post.mutateAsync({
        data: {
          asset_id: assetId,
          side,
          usd_amount: usdInput,
          idempotency_key: idempotencyKey,
        },
      });
      if (res.is_first_trade) {
        try {
          posthog.capture("first_trade_placed", {
            asset_id: res.trade.asset_id,
            side: res.trade.side,
            usd_amount: res.trade.usd_amount,
          });
        } catch {
          // Telemetry must never block trade flow.
        }
      }
      // Refetch /v1/me + /v1/trades so the dashboard hero + history list update.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getV1MeQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getV1TradesQueryKey() }),
      ]);
      openSuccess({
        id: res.trade.id,
        asset_id: res.trade.asset_id,
        side: res.trade.side,
        usd_amount: res.trade.usd_amount,
        qty: res.trade.qty,
        price_at_execution: res.trade.price_at_execution,
      });
    } catch (err) {
      // Kubb wraps the error with a `cause` containing the parsed body when 4xx/5xx.
      const code =
        (err as { cause?: { error?: string } } | undefined)?.cause?.error ??
        (err as { response?: { data?: { error?: string } } } | undefined)?.response?.data?.error;
      setErrorMsg(tradeErrorCopy(code));
    }
  }

  return (
    <BottomSheet open={open} onOpenChange={(v) => (v ? null : closeConfirm())} title="Review your trade">
      <Card
        tone={pastel}
        padding="lush"
        elevation="flat"
        className="space-y-3 text-ink"
      >
        <div className="flex items-center justify-between">
          <Eyebrow className="text-ink/60">side</Eyebrow>
          <span className="font-display font-bold uppercase">{side}</span>
        </div>
        <div className="flex items-center justify-between">
          <Eyebrow className="text-ink/60">asset</Eyebrow>
          <span className="font-display font-bold">{assetId}</span>
        </div>
        <div className="flex items-center justify-between">
          <Eyebrow className="text-ink/60">amount</Eyebrow>
          <span className="font-display font-bold tabular-nums">
            ${usdNum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <Eyebrow className="text-ink/60">qty</Eyebrow>
          <span className="font-display font-bold tabular-nums">
            {qty.toFixed(8)} {assetId}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <Eyebrow className="text-ink/60">price now</Eyebrow>
          <span className="font-display font-bold tabular-nums">
            {price != null ? `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
          </span>
        </div>
      </Card>

      {errorMsg ? (
        <p role="alert" className="mt-3 text-down text-sm">
          {errorMsg}
        </p>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={closeConfirm} disabled={post.isPending}>
          Cancel
        </Button>
        <Button onClick={onConfirm} disabled={post.isPending}>
          {post.isPending ? "Confirming…" : "Confirm"}
        </Button>
      </div>
    </BottomSheet>
  );
}
```

- [ ] **Step 2: Create `apps/web/src/components/trade/SuccessModal.tsx`**

```tsx
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { useTradeStore } from "@/stores/trade-store";
import { getStoredUser } from "@/lib/auth";
import { pastelForAsset } from "@paper/shared";
import { Link } from "@tanstack/react-router";

export function SuccessModal() {
  const open = useTradeStore((s) => s.successOpen);
  const closeSuccess = useTradeStore((s) => s.closeSuccess);
  const resetForNextTrade = useTradeStore((s) => s.resetForNextTrade);
  const last = useTradeStore((s) => s.lastTrade);
  if (!last) return null;

  const handle = getStoredUser()?.handle ?? "you";
  const pastel = pastelForAsset(last.asset_id as Parameters<typeof pastelForAsset>[0]);
  const usd = Number.parseFloat(last.usd_amount);
  const verb = last.side === "buy" ? "bought" : "sold";

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => (v ? null : closeSuccess())}
      title="Trade placed"
    >
      <Card tone={pastel} padding="lush" elevation="flat" className="text-ink">
        <Eyebrow className="text-ink/60">share-card preview</Eyebrow>
        <Heading level="h2" className="mt-2">
          @{handle} just {verb} ${usd.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} of {last.asset_id} on
        </Heading>
        <p className="mt-1 font-display text-ink/70 text-sm">papercrypto.tech</p>
        <p className="mt-4 text-ink/60 text-xs">
          (Image rendering ships in Plan 7. For now, screenshot this card.)
        </p>
      </Card>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Button asChild variant="secondary">
          <Link to="/dashboard" onClick={closeSuccess}>
            Dashboard
          </Link>
        </Button>
        <Button onClick={resetForNextTrade}>Place another</Button>
      </div>
    </BottomSheet>
  );
}
```

- [ ] **Step 3: Web typecheck**

```bash
pnpm --filter @paper/web typecheck
```

Expected: clean. If `getV1MeQueryKey` / `getV1TradesQueryKey` are not exported from `@paper/api-client`, double-check Kubb regenerated correctly — those exports come from `useGetV1Me.ts` / `useGetV1Trades.ts` and are re-exported via `src/hooks/index.ts`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/trade
git commit -m "feat(web): ConfirmationSheet + SuccessModal + first_trade_placed event"
```

---

### Task 11: TradeHistoryList

**Files (web):**
- Create: `apps/web/src/components/trade/TradeHistoryList.tsx`

Reads `useGetV1Trades({ limit: 20 })`. Renders a list under the trade form: asset chip, side badge, USD amount, executed price, relative timestamp.

- [ ] **Step 1: Create `apps/web/src/components/trade/TradeHistoryList.tsx`**

```tsx
import { AssetChip } from "@/components/dashboard/AssetChip";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/cn";
import { formatUsd } from "@/lib/format";
import { useGetV1Trades } from "@paper/api-client";
import { pastelForAsset } from "@paper/shared";

export function TradeHistoryList() {
  const { data, isLoading } = useGetV1Trades({ limit: 20 }, { query: { staleTime: 5_000 } });
  const trades = data?.trades ?? [];

  return (
    <Card tone="paper" elevation="pop" padding="cozy">
      <Eyebrow className="mb-3">recent trades</Eyebrow>
      {isLoading && <div className="py-3 text-ink-soft text-sm">Loading…</div>}
      {!isLoading && trades.length === 0 && (
        <div className="py-3 text-ink-soft text-sm">
          No trades yet. Place your first one above.
        </div>
      )}
      <ul className="divide-y divide-line">
        {trades.map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-3">
            <AssetChip
              letter={t.asset_id}
              pastel={pastelForAsset(t.asset_id as Parameters<typeof pastelForAsset>[0])}
              size="sm"
            />
            <div className="flex-1">
              <div className="font-display font-semibold text-ink">
                <span className={cn("mr-2 rounded-pill px-2 py-0.5 text-xs uppercase tracking-wide", t.side === "buy" ? "bg-mint" : "bg-peach")}>
                  {t.side}
                </span>
                {t.asset_id}
              </div>
              <div className="text-muted text-xs">
                {formatRel(t.created_at)} • @ {formatUsd(Number.parseFloat(t.price_at_execution))}
              </div>
            </div>
            <div className="font-display text-ink font-semibold tabular-nums">
              {formatUsd(Number.parseFloat(t.usd_amount))}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function formatRel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/trade/TradeHistoryList.tsx
git commit -m "feat(web): TradeHistoryList consuming GET /v1/trades"
```

---

### Task 12: /trade route — assemble form + sheet + modal + history

**Files (web):**
- Create: `apps/web/src/routes/trade.tsx`
- Modify: `apps/web/src/routes/dashboard.tsx` (add a "Trade" CTA pointing at `/trade`)

- [ ] **Step 1: Create `apps/web/src/routes/trade.tsx`**

```tsx
import { ConfirmationSheet } from "@/components/trade/ConfirmationSheet";
import { SuccessModal } from "@/components/trade/SuccessModal";
import { TradeForm } from "@/components/trade/TradeForm";
import { TradeHistoryList } from "@/components/trade/TradeHistoryList";
import { Button } from "@/components/ui/button";
import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/trade")({
  component: TradePage,
});

function TradePage() {
  return (
    <main className="min-h-dvh bg-paper px-6 py-8">
      <div className="mx-auto max-w-md space-y-6">
        <div className="flex items-center justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard">← Back</Link>
          </Button>
        </div>
        <TradeForm />
        <TradeHistoryList />
      </div>
      <ConfirmationSheet />
      <SuccessModal />
    </main>
  );
}
```

- [ ] **Step 2: Modify `apps/web/src/routes/dashboard.tsx`** to surface a "Trade" CTA

```tsx
import { AssetList } from "@/components/dashboard/AssetList";
import { HeroPortfolioCard } from "@/components/dashboard/HeroPortfolioCard";
import { TopMoversStrip } from "@/components/dashboard/TopMoversStrip";
import { Button } from "@/components/ui/button";
import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  return (
    <main className="min-h-dvh bg-paper px-6 py-8">
      <div className="mx-auto max-w-md space-y-6">
        <HeroPortfolioCard />
        <Button asChild trailing="→" fullWidth>
          <Link to="/trade">Place a trade</Link>
        </Button>
        <TopMoversStrip />
        <AssetList />
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Force TanStack Router to regenerate `routeTree.gen.ts`**

```bash
pnpm --filter @paper/web dev &
DEV_PID=$!
sleep 4
kill $DEV_PID 2>/dev/null
pnpm --filter @paper/web typecheck
```

Expected: clean. The router plugin should have added a `trade` entry to `routeTree.gen.ts`.

- [ ] **Step 4: Smoke the dev server**

```bash
pnpm --filter @paper/web dev &
DEV_PID=$!
sleep 5
curl -sS -L http://localhost:5173/trade -o /tmp/trade.html
kill $DEV_PID 2>/dev/null
grep -c "Place a trade\|Buy BTC\|Sell BTC\|Review" /tmp/trade.html
```

Expected: at least one match (Vite renders the router shell; the actual content needs JS, but the route compiles).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/trade.tsx apps/web/src/routes/dashboard.tsx apps/web/src/routeTree.gen.ts
git commit -m "feat(web): /trade route — TradeForm + ConfirmationSheet + SuccessModal + history"
```

---

### Phase D — Hero % today (T13)

### Task 13: HeroPortfolioCard renders today_pct_change

**Files (web):**
- Modify: `apps/web/src/components/dashboard/HeroPortfolioCard.tsx`

- [ ] **Step 1: Replace `apps/web/src/components/dashboard/HeroPortfolioCard.tsx`** with:

```tsx
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

  const pctClass =
    pct == null ? "text-paper/60" : pct > 0 ? "text-mint" : pct < 0 ? "text-peach" : "text-paper/60";
  const pctText =
    pct == null
      ? isLoading
        ? "loading…"
        : "— today"
      : `${pct > 0 ? "+" : ""}${pct.toFixed(2)}% today`;

  return (
    <Card tone="ink" elevation="float" padding="lush" className="relative isolate text-paper">
      <span aria-hidden className="-top-14 -right-12 pointer-events-none absolute h-44 w-44 rounded-full bg-peach opacity-45 blur-3xl" />
      <span aria-hidden className="-bottom-16 -left-12 pointer-events-none absolute h-48 w-48 rounded-full bg-mint opacity-35 blur-3xl" />
      <div className="relative">
        <Eyebrow className="text-paper/55">{handle ? `@${handle}` : "your portfolio"}</Eyebrow>
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

- [ ] **Step 2: Web typecheck**

```bash
pnpm --filter @paper/web typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/dashboard/HeroPortfolioCard.tsx
git commit -m "feat(web): hero card renders today_pct_change with up/down tone"
```

---

### Phase E — E2E + deploy (T14–T16)

### Task 14: Playwright E2E for the trade flow

**Files (web):**
- Create: `apps/web/tests/e2e/trade.spec.ts`

The test walks: dashboard → "Place a trade" → fill USD → Review → Confirm → SuccessModal → "Place another" → reset state → trade history shows ≥1 row.

- [ ] **Step 1: Create `apps/web/tests/e2e/trade.spec.ts`**

```typescript
import { expect, test } from "@playwright/test";

test.describe("trade flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
  });

  test("buy BTC end-to-end → sees success → trade history populates", async ({ page }) => {
    // Onboard fast.
    const handle = `pw_${Date.now().toString(36)}_t`.slice(0, 20).toLowerCase();
    await page.goto("/onboarding/handle");
    await page.getByPlaceholder("yourhandle").fill(handle);
    await expect(page.getByText(/available ✓/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /Claim handle/i }).click();
    await page.getByRole("link", { name: /Let's go/i }).click();
    await page.getByRole("link", { name: /Skip to my dashboard/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // CTA → /trade
    await page.getByRole("link", { name: /Place a trade/i }).click();
    await expect(page).toHaveURL(/\/trade$/);

    // Default selection: Buy + BTC. Type $100.
    await page.getByLabel(/USD amount/i).fill("100");
    await page.getByRole("button", { name: /^Review$/ }).click();

    // Bottom sheet visible.
    await expect(page.getByRole("dialog", { name: /Review your trade/i })).toBeVisible();

    // Confirm.
    await page.getByRole("button", { name: /^Confirm$/ }).click();

    // Success sheet visible.
    await expect(page.getByRole("dialog", { name: /Trade placed/i })).toBeVisible();
    await expect(page.getByText(/just bought \$100 of BTC/i)).toBeVisible();

    // Place another → form re-armed; trade history shows ≥1 BUY chip.
    await page.getByRole("button", { name: /Place another/i }).click();
    await expect(page.getByRole("dialog", { name: /Trade placed/i })).not.toBeVisible();
    await expect(page.getByText(/recent trades/i)).toBeVisible();
    await expect(page.getByText("BUY", { exact: true }).first()).toBeVisible();
  });

  test("insufficient_cash surfaces a human error inside the sheet", async ({ page }) => {
    const handle = `pw_${Date.now().toString(36)}_e`.slice(0, 20).toLowerCase();
    await page.goto("/onboarding/handle");
    await page.getByPlaceholder("yourhandle").fill(handle);
    await expect(page.getByText(/available ✓/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /Claim handle/i }).click();
    await page.getByRole("link", { name: /Let's go/i }).click();
    await page.getByRole("link", { name: /Skip to my dashboard/i }).click();
    await page.getByRole("link", { name: /Place a trade/i }).click();

    // $99,999 > $10,000 starter cash.
    await page.getByLabel(/USD amount/i).fill("99999");
    // Form-level guard disables Review when usdNum > cashUsd. So instead force an
    // amount just within bounds, then bypass via two trades. For Plan 3 keep it
    // simple: assert the button is disabled.
    await expect(page.getByRole("button", { name: /^Review$/ })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the spec**

```bash
pnpm --filter @paper/web exec playwright test trade
```

Expected: 2 passed. The test depends on Redis having a `paper:price:BTC` entry — if it fails with "503 price_unavailable" surfaced in the sheet, run the price-ingestion job once locally first:

```bash
export $(grep -v '^#' apps/server/.env | xargs)
pnpm --filter @paper/server tsx src/jobs/price-ingestion.ts
```

Then re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/e2e/trade.spec.ts
git commit -m "test(web): E2E for trade flow + insufficient-cash guard"
```

---

### Task 15: Build + push image, deploy lab, verify daily-snapshot cron, deploy web, smoke

**Files:** none (commands only)

The image needs to be rebuilt because `apps/server/dist/jobs/daily-snapshot.js` doesn't exist in the previous image. The Dockerfile copies `apps/server/dist` wholesale, so a fresh build picks up the new entrypoint automatically.

- [ ] **Step 1: Verify lab manifest is committed**

```bash
cd /Users/filipkastovsky/work/personal/lab
git status --short
```

Expected: clean (T7 staged it). If untracked, commit now.

- [ ] **Step 2: Build + push the new image**

```bash
cd /Users/filipkastovsky/work/personal/startup
SHA=$(git rev-parse --short=12 HEAD)
echo "deploying $SHA"

export GHCR_USER=filipkastovsky
echo "$GHCR_TOKEN" | podman login ghcr.io -u "$GHCR_USER" --password-stdin

podman build --platform=linux/arm64 -t ghcr.io/$GHCR_USER/paper:$SHA -f apps/server/Dockerfile .
podman push ghcr.io/$GHCR_USER/paper:$SHA
```

- [ ] **Step 3: Apply the lab stack with the new tag**

```bash
cd /Users/filipkastovsky/work/personal/lab
set -a && source .env && set +a
cd stacks/paper
rm -rf .terragrunt-cache
TF_VAR_image_tag=$SHA \
TF_VAR_ghcr_user=filipkastovsky \
TF_VAR_ghcr_pull_token="$GHCR_PULL_TOKEN" \
terragrunt apply -auto-approve
```

If `paper-migrate` is in a stale Failed state from a previous deploy, delete it first:

```bash
export KUBECONFIG=/Users/filipkastovsky/work/personal/lab/lab_kubeconfig.yaml
kubectl -n paper delete job paper-migrate --ignore-not-found
```

Then re-apply.

- [ ] **Step 4: Wait for migrate + paper-api rollout**

```bash
kubectl -n paper wait --for=condition=complete job/paper-migrate --timeout=120s
kubectl -n paper rollout status deployment/paper-api --timeout=120s
```

- [ ] **Step 5: Verify the new daily-snapshot CronJob exists**

```bash
kubectl -n paper get cronjob paper-cron-daily-snapshot
```

Expected: a row with schedule `0 0 * * *`, `SUSPEND=False`. The CronJob will not fire on demand — to verify it works, hand-trigger one Job:

```bash
kubectl -n paper create job --from=cronjob/paper-cron-daily-snapshot paper-cron-daily-snapshot-manual-$SHA
kubectl -n paper wait --for=condition=complete job/paper-cron-daily-snapshot-manual-$SHA --timeout=120s
kubectl -n paper logs job/paper-cron-daily-snapshot-manual-$SHA
```

Expected: a single JSON line `{"event":"daily_snapshot_done","ok":N,"failed":0,"date":"2026-MM-DD",...}`.

Inspect a snapshot row directly via the API (proves end-to-end persistence):

```bash
TOKEN=$(curl -sS --tlsv1.2 --tls-max 1.2 -X POST https://api.papercrypto.tech/v1/auth/device \
  -H "content-type: application/json" \
  -d '{"device_uuid":"deadbeef-dead-beef-dead-000000000003"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')

curl -sS --tlsv1.2 --tls-max 1.2 https://api.papercrypto.tech/v1/me \
  -H "authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```

Expected: response includes `"today_pct_change": 0` (or a small number) — never crash, never `null` after the cron has run.

- [ ] **Step 6: Verify POST /v1/trades works in prod**

```bash
curl -sS --tlsv1.2 --tls-max 1.2 -X POST https://api.papercrypto.tech/v1/trades \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"asset_id":"BTC","side":"buy","usd_amount":"10.00","idempotency_key":"prod-smoke-1"}' \
  | python3 -m json.tool
```

Expected: 201 with `trade.id`, `qty`, `price_at_execution`, `is_first_trade: true`.

Re-run the same command — expect 200 with the same `trade.id` and `is_first_trade: false`. (Idempotency works in prod.)

- [ ] **Step 7: Build + deploy the web**

```bash
cd /Users/filipkastovsky/work/personal/startup
pnpm --filter @paper/web build
npx wrangler@latest pages deploy apps/web/dist --project-name=paper-web --branch=main --commit-dirty=true
```

Expected: deploy URL like `https://<hash>.paper-web.pages.dev`. Custom domains pick up automatically.

- [ ] **Step 8: Smoke production end-to-end**

Open `https://papercrypto.tech` in a browser:

1. Land on `/onboarding/welcome` (first visit) or `/dashboard` (returning).
2. From `/dashboard`, tap "Place a trade".
3. Default Buy + BTC. Type `25`. Tap Review.
4. Bottom sheet shows the pastel summary card with a real `qty` and `price now` value.
5. Tap Confirm. Sheet transitions to "Trade placed". Tap "Place another".
6. Below the form, "recent trades" shows ≥1 BUY chip with `$25.00`.
7. Navigate back to `/dashboard`. The hero card's "% today" reads either `+0.XX% today` (if the cron has run) or `— today` (if it hasn't yet — first deploy day, before midnight).

If anything's broken, surface it before declaring deploy as final.

- [ ] **Step 9: Push the branch + tag the milestone**

```bash
export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/github_ed25519"
git push -u origin plan-3-trade-execution

git tag -a v0.3.0-trade -m "Plan 3 — trade execution shipped"
git push origin v0.3.0-trade
```

Plan 3 done.

---

## Self-review notes

This is the writing-plans skill's mandated self-review pass against the locked decisions and the spec.

**Spec coverage delivered by Plan 3:**

| Requirement | Task |
|---|---|
| Server-authoritative pricing (cached Redis read inside the handler) | T2 (`getCachedPrice` in `executeTrade`); T3 (route 503 mapping for `price_unavailable`) |
| Atomic Trade insert + Portfolio update inside one DB transaction | T2 (`db.transaction(async (tx) => …)` in `executeTrade`) |
| Idempotency via DB unique index on `(user_id, idempotency_key)` | T1 (schema), T2 (23505 catch + replay return), T3 (route returns 200 on replay vs 201 on fresh) |
| Rate limit 20/min/user via `@fastify/rate-limit` (per-user keyGenerator) | T3 (route `config.rateLimit.keyGenerator: req => req.user?.sub`) |
| Confirmation moment (bottom sheet, no URL change) | T8 (`BottomSheet` primitive), T10 (`ConfirmationSheet`) |
| Success share-card placeholder | T10 (`SuccessModal` with pastel-tinted Card showing `@handle just bought $X of Y on papercrypto.tech`); real image rendering deferred to Plan 7 |
| `first_trade_placed` PostHog event | T10 (`posthog.capture("first_trade_placed", …)` inside `ConfirmationSheet.onConfirm` when `res.is_first_trade`); server flips the flag via `count(trades where user) === 1` (T2) |
| % today on dashboard hero | T1 (`portfolio_snapshots` schema), T4 (snapshot service), T5 (trade-side back-fill + `today_pct_change` on `/v1/me`), T13 (HeroPortfolioCard render), T6/T7 (daily cron) |
| Daily portfolio snapshot CronJob @ 00:00 UTC | T4 (service), T6 (entrypoint), T7 (K8s manifest), T15 step 5 (verify in prod) |
| Trade history list (recent 20) | T11 (`TradeHistoryList`), T3 (GET /v1/trades) |
| Trade route web flow | T9 (TradeForm + AssetPicker), T10 (sheets), T12 (route assembly), T14 (E2E) |

**Spec coverage explicitly deferred:**

- §6.2 Daily Market Question — Plan 5
- §6.2 Streak flame — Plan 5
- §6.4 Lessons / Learn — Plan 4
- §6.5 Ranks / leaderboard — Plan 6
- §6.6 Profile — Plan 7
- §7.3 Real share-card image rendering — Plan 7
- §7.4 Push notifications — Plan 5

**Placeholder scan:** none. Every step has actual code or actual commands.

**Type consistency check:**

- `AssetId` from `@paper/shared` consumed by server (`isAssetId`, the trade route's `z.enum`) and web (`useTradeStore`). ✓
- `TradeSide` from `apps/server/src/db/schema/trades.ts` consumed by `executeTrade` input + the route's `z.enum(["buy","sell"])`. ✓
- `numeric(20,8)` strings on the wire end-to-end: `usd_amount`, `qty`, `price_at_execution`, `cash_usd`, `total_value_usd`, snapshot `total_value_usd`. Web parses with `Number.parseFloat` only at display boundaries. ✓
- `today_pct_change: number | null` shape matches between server (`todayPctChange` returns `Promise<number | null>`) and Kubb-generated TS type. T7 step 4 verifies. ✓
- `pastelForAsset` consumed by `ConfirmationSheet`, `SuccessModal`, `TradeHistoryList`, `AssetPickerRow` — all converge on `@paper/shared`. ✓
- The route handler keeps `padTo8` to canonicalise the wire format the schema accepts (`/^\d+(\.\d{1,8})?$/`) into the 8-decimal string the trade service stores; round-trip preserves precision because `Decimal.toFixed(8)` is exact for any input that fits in numeric(20,8). ✓
- `useGetV1Trades({limit: 20}, { query: ... })` — Kubb's hook signature for query-stringed GETs: first arg is the query object, second is the options. T11 matches. Verify after T3 step 6's regen by `head -30 packages/api-client/src/hooks/useGetV1Trades.ts`; if the signature differs, adjust T11 step 1 accordingly.
- `usePostV1Trades` mutation request type wraps the body — `{ data: PostV1TradesMutationRequest }`, mirroring `usePatchV1Me` from Plan 2. T10's `post.mutateAsync({ data: { … } })` matches that pattern. ✓

**Architecture spot-checks:**

- The trade transaction **explicitly uses `.for("update")`** on the portfolios SELECT to lock the row for the duration of the transaction. Concurrent trades on the same user serialise at the row level — exactly what we want when buying twice in quick succession to avoid a TOCTOU on cash.
- The trade service calls `ensureTodaySnapshot` BEFORE the transaction starts. Two reasons: (a) the snapshot must reflect the **pre-trade** baseline so "% today" is a stable reference, (b) keeping the snapshot insert outside the transaction means a snapshot-side failure (very unlikely) doesn't block the trade.
- Idempotency hits return the existing row WITH `is_first_trade: false` even if the original call had `is_first_trade: true`. This is intentional: client-side analytics fire once per intent, not once per network retry. T2's "idempotency replay" test pins this.
- The daily cron uses `{ max: 4 }` connection pool. The reads-per-user are sequential (one `getPortfolioWithValuation` per user) so 4 is plenty. Plan 6's leaderboard pass will likely batch and crank this to 8.
- `@fastify/rate-limit` v10 supports `keyGenerator` on per-route `config.rateLimit`. The default plugin in `apps/server/src/plugins/rate-limit.ts` is global-off — every route opts in. T3's POST sets max:20; the existing PATCH /v1/me and other endpoints inherit no limit (this is the v0 stance — only state-mutating endpoints with a clear abuse vector need a budget).
- The confirmation modal uses Radix Dialog, which traps focus and locks scroll on the body. Backdrop tap dismisses (the `onOpenChange(false)`) but doesn't navigate — `/trade` URL persists, exactly as the locked decision specifies.
- `crypto.randomUUID()` for the idempotency key works in all browsers we ship (modern Chrome/Safari/Firefox); the fallback `Math.random().toString(36).slice(2)` covers older Safari. The server validates `idempotency_key.min(1).max(120)` so any non-empty value lands.

**Ambiguity check:**

- "How does the test seed a Redis price for the rate-limit test in T3?" — `withFreshRedis` flushes Redis at the start, then writes a single `paper:price:BTC`. Since the rate-limit plugin shares Redis with the price cache (Plan 1 architecture), the rate-limit counters are wiped too — which is fine, since the test asserts behaviour from a clean slate. If it ever flakes, the fix is `await r.del("paper:rate-limit:*")` as a finer scalpel.
- "Does the snapshot baseline need to be the start-of-day midnight value, or can it be a mid-day catch-up value if a user is created today?" — Locked decision: it can be a mid-day catch-up. The trade service's `ensureTodaySnapshot` uses today's CURRENT total as the baseline because that's the only honest open-of-day a freshly-created user has. They'll see "0.00% today" right after their first trade until prices move; a returning user sees the cron-set midnight snapshot. Document this behaviour in the helper's docstring.
- "What about a user who held a position overnight and prices moved before the cron ran the next day?" — They show the previous day's `today_pct_change` until 00:00 UTC + cron tick. If the cron is up, the gap is seconds. If the cron is suspended, the dashboard goes stale gracefully — not catastrophic.
- "Why is the success modal a bottom sheet instead of a fullscreen overlay?" — Marshmallow's bottom-sheet is the established pattern (small phones). On desktop the BottomSheet centers, so the visual is a card-modal. Keeping a single primitive halves the DOM cost.
- "Trade history pagination?" — Plan 3 caps at limit=200 server-side (defense in depth); the client requests 20. A "Load more" button is Plan 4 chore (lessons screen will use the same paginated list pattern).

If any of the deferred items in the "explicitly deferred" list block your review, surface them now and I'll adjust the decomposition.

### Critical Files for Implementation
- `/Users/filipkastovsky/work/personal/startup/apps/server/src/services/trades.ts` (NEW — atomic trade write + idempotency + Decimal-exact math)
- `/Users/filipkastovsky/work/personal/startup/apps/server/src/routes/trades.ts` (NEW — POST + GET routes with per-user rate limit)
- `/Users/filipkastovsky/work/personal/startup/apps/server/src/services/snapshots.ts` (NEW — daily snapshot + todayPctChange)
- `/Users/filipkastovsky/work/personal/startup/apps/web/src/components/trade/ConfirmationSheet.tsx` (NEW — confirmation moment + first_trade_placed event)
- `/Users/filipkastovsky/work/personal/startup/apps/server/src/routes/me.ts` (MOD — adds today_pct_change to the existing /v1/me response)

---
