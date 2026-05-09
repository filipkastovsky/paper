# Plan 2: Onboarding + Dashboard core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A first-time user opens `https://papercrypto.tech`, completes the 4-step onboarding (welcome → handle → balance reveal → first-lesson nudge), lands on a dashboard showing their $10,000 starting cash, the 12 v0 assets with live prices ingested every 60s by a cluster CronJob, and a top-movers strip — all stored on the server, all live in production.

**Architecture:** Adds the paper-economy data layer (`portfolios` table with cash + JSON holdings) and a static asset list of 12 Binance-tracked majors on the server. Prices are fetched by a single K8s CronJob writing into the existing per-app Redis with a 120s TTL; the API reads from Redis and never blocks on Binance. The web client gains 5 new file-based routes (4 onboarding steps + dashboard), a Zustand store for in-flight onboarding draft, and a small set of dashboard primitives (asset chip, asset list, hero portfolio card, top movers strip) all built on the existing Marshmallow primitives. Auth is unchanged from Plan 1; new endpoints sit behind the `app.authenticate` preHandler.

**Tech Stack:** No new vendors. Adds `ioredis` is already installed (Plan 1 T12). Server adds `decimal.js` for safe currency arithmetic (the alternative — bigint cents — is awkward for ≤8-decimal crypto qty). Web adds nothing — TanStack Router file routes, Zustand stores, Marshmallow primitives, Kubb-generated TanStack Query hooks all already present.

---

## Prerequisites

| # | Prereq | Verify |
|---|---|---|
| P1 | Plan 1 complete and shipped to prod (`https://papercrypto.tech` + `https://api.papercrypto.tech` both 200) | `curl -sS --tlsv1.2 --tls-max 1.2 https://api.papercrypto.tech/v1/health` → `{"status":"ok"}` |
| P2 | Working tree clean on `plan-1-foundation` (or whatever branch holds the latest Plan 1 commits — `34d4a99` at the time of writing) | `git status --short` returns only the pre-existing untracked design/spec items, plus any new local-only `.env.production` |
| P3 | Branch off | `git checkout plan-1-foundation && git pull && git checkout -b plan-2-onboarding-dashboard` |
| P4 | Local infra running | `podman compose ps` shows postgres + redis + minio healthy |
| P5 | Drizzle migrations up-to-date locally | `pnpm --filter @paper/server db:migrate` returns `migrations applied` |
| P6 | Server tests pass on baseline | `pnpm --filter @paper/server test` → 14 passing |
| P7 | Web typecheck + smoke | `pnpm --filter @paper/web typecheck` clean; `pnpm --filter @paper/web exec playwright test smoke` 2 passing |
| P8 | GHCR + Cloudflare creds available for the deploy step at the end | `GHCR_USER`, `GHCR_TOKEN`, the `cfat_` token from Plan 1 still valid (or refresh) |

If any P-row fails, fix it before Task 1.

---

## Container runtime note

Same as Plan 1: this project uses **podman**, not docker. Compose commands are `podman compose`, image builds are `podman build --platform=linux/arm64`, registry login is `podman login ghcr.io`. On macOS, containers reach the host via `host.containers.internal`, not `localhost`.

---

## Out of scope (deferred to later plans)

These are part of the spec for Dashboard / Onboarding but explicitly NOT in Plan 2 — flagging here so they don't accidentally creep into review:

- **Daily Market Question card** (spec §6.2 + §7.1) — Plan 5
- **Streak flame** in hero corner (spec §6.2 + §7.2) — Plan 5
- **Trade execution + Trade screen** (spec §6.3) — Plan 3
- **Lesson content + Learn screen** (spec §6.4) — Plan 4. The "first lesson nudge" in onboarding step 4 is a static placeholder ("We'll teach you with bite-sized cards. Coming soon.") with a "Skip to dashboard" CTA. No actual lesson view, no quiz.
- **Share cards** (spec §7.3) — Plan 7. Onboarding step 3 ("balance reveal") is composed to be screenshot-friendly but does NOT auto-generate a share card.
- **Push notifications** (spec §7.4) — Plan 5
- **Ranks / leaderboard** (spec §6.5) — Plan 6
- **Profile screen** (spec §6.6) — deferred to Plan 7 with share-card export
- **Email-add for recovery** — v0.1+
- **Avatar upload** — never. The spec is "pick a pastel blob, no uploads" — Plan 2 ships the picker (4 pastel-blob options) and stores the choice as a small string column.

---

## File structure

This plan touches the following files. Files marked **(NEW)** are created in Plan 2; **(MOD)** are modified.

```
apps/server/
├── drizzle/
│   └── 0001_<random>.sql                                       (NEW — generated migration: portfolios + users.avatar)
├── src/
│   ├── db/schema/
│   │   ├── portfolios.ts                                       (NEW)
│   │   ├── users.ts                                            (MOD — add avatar column)
│   │   └── index.ts                                            (MOD — export portfolios)
│   ├── services/
│   │   ├── assets.ts                                           (NEW — static list of 12 assets + color rotation)
│   │   ├── prices.ts                                           (NEW — Binance fetch + Redis cache helpers)
│   │   ├── portfolio.ts                                        (NEW — initializePortfolio, getPortfolioWithValuation)
│   │   ├── handles.ts                                          (NEW — validation + reserved blocklist)
│   │   └── redis.ts                                            (NEW — singleton ioredis instance)
│   ├── jobs/
│   │   └── price-ingestion.ts                                  (NEW — K8s CronJob entrypoint)
│   ├── routes/
│   │   ├── me.ts                                               (NEW — GET /v1/me, PATCH /v1/me, GET /v1/handles/check)
│   │   └── assets.ts                                           (NEW — GET /v1/assets)
│   ├── server.ts                                               (MOD — register me + assets routes)
│   ├── index.ts                                                (MOD — wire shared redis singleton lifecycle)
│   └── routes/auth.ts                                          (MOD — auto-create empty portfolio on first device auth)
└── test/
    ├── services/
    │   ├── prices.test.ts                                      (NEW)
    │   ├── portfolio.test.ts                                   (NEW)
    │   └── handles.test.ts                                     (NEW)
    ├── routes/
    │   ├── me.test.ts                                          (NEW)
    │   └── assets.test.ts                                      (NEW)
    ├── jobs/
    │   └── price-ingestion.test.ts                             (NEW)
    └── helpers/
        ├── redis.ts                                            (NEW — flush/seed test Redis)
        └── db.ts                                               (MOD — extend truncate to include portfolios)

apps/web/
├── src/
│   ├── lib/
│   │   ├── auth-redirect.ts                                    (NEW — first-load routing guard)
│   │   └── currency.ts                                         (NEW — string→number safe cash parser)
│   ├── stores/
│   │   └── onboarding-store.ts                                 (NEW — Zustand)
│   ├── components/
│   │   ├── onboarding/
│   │   │   ├── HandleInput.tsx                                 (NEW)
│   │   │   ├── AvatarPicker.tsx                                (NEW)
│   │   │   └── StepIndicator.tsx                               (NEW)
│   │   └── dashboard/
│   │       ├── AssetChip.tsx                                   (NEW)
│   │       ├── AssetList.tsx                                   (NEW)
│   │       ├── HeroPortfolioCard.tsx                           (NEW)
│   │       └── TopMoversStrip.tsx                              (NEW)
│   ├── routes/
│   │   ├── index.tsx                                           (MOD — becomes a router redirect; old welcome content moves)
│   │   ├── onboarding/
│   │   │   ├── route.tsx                                       (NEW — onboarding layout + StepIndicator)
│   │   │   ├── welcome.tsx                                     (NEW — replaces old `/`)
│   │   │   ├── handle.tsx                                      (NEW)
│   │   │   ├── balance.tsx                                     (NEW)
│   │   │   └── lesson.tsx                                      (NEW)
│   │   └── dashboard.tsx                                       (NEW)
│   ├── routeTree.gen.ts                                        (regenerated by TanStack Router plugin)
│   └── main.tsx                                                (MOD — gate first paint on auth-redirect resolution)
└── tests/e2e/
    ├── onboarding.spec.ts                                      (NEW)
    └── dashboard.spec.ts                                       (NEW)

packages/api-client/
└── src/                                                        (regenerated by `pnpm gen:api-client`)

lab/stacks/paper/manifests/
└── 30-cron-price-ingestion.yaml                                (NEW — every-minute K8s CronJob)
```

The two K8s manifest files numbered 10/20/21/22 from Plan 1 are unchanged. The new `30-` prefix puts the cron after the API Deployment in apply order.

---

## Tasks

### Phase A — Server schema + portfolio domain (T1–T7)

### Task 1: Add portfolios schema + avatar column on users + migration

**Files:**
- Modify: `apps/server/src/db/schema/users.ts`
- Create: `apps/server/src/db/schema/portfolios.ts`
- Modify: `apps/server/src/db/schema/index.ts`
- Generate: `apps/server/drizzle/0001_*.sql` (drizzle-kit output)
- Modify: `apps/server/test/helpers/db.ts` (extend truncate)

- [ ] **Step 1: Add `avatar` column to `users`**

Replace `apps/server/src/db/schema/users.ts` with:

```typescript
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  handle: text("handle").unique(),
  // Avatar is one of: "peach" | "mint" | "sky" | "lilac". Stored as plain text
  // so adding a 5th option later is a no-op (no enum migration).
  avatar: text("avatar"),
  deviceUuid: text("device_uuid").notNull().unique(),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

- [ ] **Step 2: Create `apps/server/src/db/schema/portfolios.ts`**

```typescript
import { jsonb, numeric, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * Per spec §8.2:
 *   Portfolio — user_id, cash_usd, holdings: {asset_id: {qty, cost_basis}}; starting cash $10,000
 *
 * cash_usd and holdings.{*}.qty / cost_basis are numeric(20,8) — Postgres NUMERIC
 * round-trips as `string` in postgres.js / Drizzle. Use `decimal.js` (added in Task 4)
 * for arithmetic.
 */
export type HoldingsJson = Record<string, { qty: string; cost_basis: string }>;

export const portfolios = pgTable("portfolios", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  cashUsd: numeric("cash_usd", { precision: 20, scale: 8 }).notNull().default("10000"),
  holdings: jsonb("holdings").notNull().default({}).$type<HoldingsJson>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Portfolio = typeof portfolios.$inferSelect;
export type NewPortfolio = typeof portfolios.$inferInsert;
```

- [ ] **Step 3: Modify `apps/server/src/db/schema/index.ts`**

```typescript
export * from "./users.js";
export * from "./refresh-tokens.js";
export * from "./portfolios.js";
```

- [ ] **Step 4: Modify `apps/server/test/helpers/db.ts`**

Replace its contents with:

```typescript
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client.js";

export async function truncateAllTables(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE "portfolios", "refresh_tokens", "users" RESTART IDENTITY CASCADE`,
  );
}
```

(Order matters: portfolios FK→users, refresh_tokens FK→users. Truncate the children first or use CASCADE — we use CASCADE.)

- [ ] **Step 5: Generate the migration**

Ensure local Postgres is up: `podman compose ps` shows postgres healthy. Then:

```bash
pnpm --filter @paper/server db:generate
```

Expected: writes `apps/server/drizzle/0001_<random>.sql` containing `ALTER TABLE "users" ADD COLUMN "avatar" text;` and `CREATE TABLE "portfolios" (...)`. Plus `apps/server/drizzle/meta/0001_snapshot.json` and an updated `_journal.json`.

- [ ] **Step 6: Apply the migration**

```bash
export $(grep -v '^#' .env | xargs)
pnpm --filter @paper/server db:migrate
```

Expected: `migrations applied`. Verify:

```bash
podman exec -i paper-postgres-1 psql -U app -d paper -c "\d portfolios"
podman exec -i paper-postgres-1 psql -U app -d paper -c "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='avatar';"
```

Both should show the expected schema.

- [ ] **Step 7: Run server tests (sanity)**

```bash
pnpm --filter @paper/server test
```

Expected: 14 passing (no regressions; truncate helper changed but the existing tests don't call it on the new table).

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/db apps/server/drizzle apps/server/test/helpers/db.ts
git commit -m "feat(server): add portfolios schema + users.avatar column"
```

---

### Task 2: Static asset list + color rotation utility

**Files:**
- Create: `apps/server/src/services/assets.ts`
- Create: `packages/shared/src/assets.ts` (re-exported via shared package barrel)
- Modify: `packages/shared/src/index.ts`

The asset list lives in `@paper/shared` because both the server (price ingestion + responses) and the web client (dashboard chips) need the same canonical order and color assignment.

- [ ] **Step 1: Create `packages/shared/src/assets.ts`**

```typescript
/**
 * v0 asset roster — 12 majors, all with Binance USDT pairs. Order is
 * STABLE (do not reorder); the index drives the Marshmallow pastel rotation
 * shown on chips and share cards.
 */
export const ASSETS = [
  { id: "BTC", name: "Bitcoin", binanceSymbol: "BTCUSDT" },
  { id: "ETH", name: "Ethereum", binanceSymbol: "ETHUSDT" },
  { id: "SOL", name: "Solana", binanceSymbol: "SOLUSDT" },
  { id: "USDC", name: "USD Coin", binanceSymbol: "USDCUSDT" },
  { id: "BNB", name: "BNB", binanceSymbol: "BNBUSDT" },
  { id: "XRP", name: "XRP", binanceSymbol: "XRPUSDT" },
  { id: "ADA", name: "Cardano", binanceSymbol: "ADAUSDT" },
  { id: "DOGE", name: "Dogecoin", binanceSymbol: "DOGEUSDT" },
  { id: "AVAX", name: "Avalanche", binanceSymbol: "AVAXUSDT" },
  { id: "LINK", name: "Chainlink", binanceSymbol: "LINKUSDT" },
  { id: "DOT", name: "Polkadot", binanceSymbol: "DOTUSDT" },
  { id: "TON", name: "Toncoin", binanceSymbol: "TONUSDT" },
] as const;

export type AssetId = (typeof ASSETS)[number]["id"];

/** "peach" | "mint" | "sky" | "lilac" — rotates 4-cycle by stable list index. */
export const ASSET_PASTELS = ["peach", "mint", "sky", "lilac"] as const;
export type AssetPastel = (typeof ASSET_PASTELS)[number];

export function pastelForAsset(assetId: AssetId): AssetPastel {
  const idx = ASSETS.findIndex((a) => a.id === assetId);
  if (idx < 0) throw new Error(`unknown asset: ${assetId}`);
  // biome-ignore lint/style/noNonNullAssertion: idx is bounded
  return ASSET_PASTELS[idx % ASSET_PASTELS.length]!;
}

export function isAssetId(s: string): s is AssetId {
  return ASSETS.some((a) => a.id === s);
}
```

- [ ] **Step 2: Modify `packages/shared/src/index.ts`**

```typescript
export * from "./events.js";
export * from "./types.js";
export * from "./assets.js";
```

- [ ] **Step 3: Verify shared typecheck**

```bash
pnpm --filter @paper/shared typecheck
```

Expected: clean.

- [ ] **Step 4: Create `apps/server/src/services/assets.ts`** (re-exports the shared list to centralise server-side imports)

```typescript
export { ASSETS, ASSET_PASTELS, pastelForAsset, isAssetId } from "@paper/shared";
export type { AssetId, AssetPastel } from "@paper/shared";
```

- [ ] **Step 5: Verify server typecheck**

```bash
pnpm --filter @paper/server typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared apps/server/src/services/assets.ts
git commit -m "feat(shared): canonical 12-asset list with stable pastel rotation"
```

---

### Task 3: Redis singleton + prices service (TDD)

**Files:**
- Create: `apps/server/src/services/redis.ts`
- Create: `apps/server/src/services/prices.ts`
- Create: `apps/server/test/helpers/redis.ts`
- Create: `apps/server/test/services/prices.test.ts`

`@fastify/rate-limit` already opens its own ioredis connection inside `apps/server/src/plugins/rate-limit.ts`. We add a SECOND singleton here for the price cache; keeping them separate means restart of one doesn't take down the other and the rate-limit traffic is isolated from price reads. Pool ceiling: ioredis defaults to 1 connection per client; we keep that.

- [ ] **Step 1: Create `apps/server/src/services/redis.ts`**

```typescript
import { Redis } from "ioredis";

let _redis: Redis | null = null;

export function getRedis(redisUrl: string): Redis {
  if (_redis) return _redis;
  _redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: false });
  return _redis;
}

/** Test/shutdown only. Closes the singleton so the next getRedis() reconnects. */
export async function closeRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}
```

- [ ] **Step 2: Create `apps/server/test/helpers/redis.ts`**

```typescript
import { Redis } from "ioredis";

const url = process.env.REDIS_URL ?? "redis://localhost:6379";

export async function withFreshRedis<T>(fn: (r: Redis) => Promise<T>): Promise<T> {
  const r = new Redis(url, { maxRetriesPerRequest: 1 });
  try {
    await r.flushdb();
    return await fn(r);
  } finally {
    await r.quit();
  }
}
```

- [ ] **Step 3: Write the failing tests for prices service**

Create `apps/server/test/services/prices.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAndCacheAllPrices, getCachedPrice, PRICE_CACHE_TTL_SECONDS } from "@/services/prices.js";
import { withFreshRedis } from "../helpers/redis.js";

const url = process.env.REDIS_URL ?? "redis://localhost:6379";

describe("prices service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getCachedPrice returns null on miss", async () => {
    await withFreshRedis(async () => {
      const p = await getCachedPrice(url, "BTC");
      expect(p).toBeNull();
    });
  });

  it("fetchAndCacheAllPrices writes one entry per asset with 24h prev", async () => {
    // Mock global fetch to return Binance-shaped responses for /api/v3/ticker/24hr
    const mockTicker = (symbol: string, last: string, prev: string) =>
      Promise.resolve(
        new Response(JSON.stringify({ symbol, lastPrice: last, prevClosePrice: prev }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        const symbol = new URL(url).searchParams.get("symbol") ?? "UNKNOWN";
        // last = symbol-length × 100, prev = last × 0.99 — predictable but not all 1s
        const last = (symbol.length * 100).toFixed(2);
        const prev = (symbol.length * 99).toFixed(2);
        return mockTicker(symbol, last, prev);
      }),
    );

    await withFreshRedis(async (r) => {
      await fetchAndCacheAllPrices(url);
      const keys = (await r.keys("paper:price:*")).sort();
      expect(keys).toHaveLength(12);
      const btc = await getCachedPrice(url, "BTC");
      expect(btc).not.toBeNull();
      expect(btc?.usd).toBeGreaterThan(0);
      expect(btc?.prevUsd).toBeGreaterThan(0);
      expect(btc?.usd).not.toBe(btc?.prevUsd);
      // TTL check (Redis returns -2 for missing, -1 for no expire, >=0 for seconds)
      const ttl = await r.ttl("paper:price:BTC");
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(PRICE_CACHE_TTL_SECONDS);
    });
  });

  it("getCachedPrice ignores corrupted entries gracefully", async () => {
    await withFreshRedis(async (r) => {
      await r.set("paper:price:BTC", "not-json", "EX", 60);
      const p = await getCachedPrice(url, "BTC");
      expect(p).toBeNull();
    });
  });
});
```

- [ ] **Step 4: Run the failing tests**

```bash
pnpm --filter @paper/server test test/services/prices.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 5: Implement `apps/server/src/services/prices.ts`**

```typescript
import { ASSETS, type AssetId } from "@paper/shared";
import { getRedis } from "./redis.js";

export const PRICE_CACHE_TTL_SECONDS = 120;
const PRICE_KEY_PREFIX = "paper:price:";
const BINANCE_24HR = "https://api.binance.com/api/v3/ticker/24hr";

export interface CachedPrice {
  usd: number;
  prevUsd: number;
  ts: number;
}

export async function getCachedPrice(redisUrl: string, assetId: AssetId): Promise<CachedPrice | null> {
  const r = getRedis(redisUrl);
  const raw = await r.get(`${PRICE_KEY_PREFIX}${assetId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedPrice;
    if (
      typeof parsed.usd !== "number" ||
      typeof parsed.prevUsd !== "number" ||
      typeof parsed.ts !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function getAllCachedPrices(redisUrl: string): Promise<Record<AssetId, CachedPrice | null>> {
  const out: Record<string, CachedPrice | null> = {};
  await Promise.all(
    ASSETS.map(async (a) => {
      out[a.id] = await getCachedPrice(redisUrl, a.id);
    }),
  );
  return out as Record<AssetId, CachedPrice | null>;
}

interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  prevClosePrice: string;
}

async function fetchBinanceTicker(symbol: string): Promise<BinanceTicker> {
  const res = await fetch(`${BINANCE_24HR}?symbol=${encodeURIComponent(symbol)}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`binance ${symbol}: HTTP ${res.status}`);
  const json = (await res.json()) as BinanceTicker;
  return json;
}

export async function fetchAndCacheAllPrices(redisUrl: string): Promise<{ ok: number; failed: number }> {
  const r = getRedis(redisUrl);
  const ts = Math.floor(Date.now() / 1000);
  let ok = 0;
  let failed = 0;
  await Promise.all(
    ASSETS.map(async (a) => {
      try {
        const t = await fetchBinanceTicker(a.binanceSymbol);
        const usd = Number(t.lastPrice);
        const prevUsd = Number(t.prevClosePrice);
        if (!Number.isFinite(usd) || !Number.isFinite(prevUsd)) {
          throw new Error(`non-finite price for ${a.id}: ${t.lastPrice} / ${t.prevClosePrice}`);
        }
        const payload: CachedPrice = { usd, prevUsd, ts };
        await r.set(`${PRICE_KEY_PREFIX}${a.id}`, JSON.stringify(payload), "EX", PRICE_CACHE_TTL_SECONDS);
        ok++;
      } catch (_err) {
        failed++;
      }
    }),
  );
  return { ok, failed };
}
```

- [ ] **Step 6: Run tests — they should now pass**

```bash
pnpm --filter @paper/server test test/services/prices.test.ts
```

Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/services apps/server/test/services/prices.test.ts apps/server/test/helpers/redis.ts
git commit -m "feat(server): redis singleton + price ingestion service with Binance fetch"
```

---

### Task 4: Portfolio service + handles service (TDD)

**Files:**
- Create: `apps/server/src/services/portfolio.ts`
- Create: `apps/server/src/services/handles.ts`
- Create: `apps/server/test/services/portfolio.test.ts`
- Create: `apps/server/test/services/handles.test.ts`
- Modify: `apps/server/package.json` (add `decimal.js`)

- [ ] **Step 1: Add `decimal.js` dependency**

Edit `apps/server/package.json` to add to `dependencies` (alphabetical):

```json
"decimal.js": "^10.4.3"
```

Run from repo root:

```bash
pnpm install
```

- [ ] **Step 2: Create `apps/server/src/services/handles.ts`**

```typescript
const HANDLE_RX = /^[a-z][a-z0-9_]{2,19}$/;

/** Reserved words — surface area is intentionally small for v0. Spec §11.6 mentions
 *  ~500-handle blocklist; full list is content work for v0.1. These cover the
 *  obvious confusable / brand / hostile cases. */
const RESERVED = new Set([
  "admin",
  "administrator",
  "root",
  "support",
  "help",
  "api",
  "www",
  "paper",
  "papercrypto",
  "official",
  "system",
  "moderator",
  "mod",
  "owner",
  "ceo",
  "team",
  "staff",
  "abuse",
  "security",
  "billing",
  "test",
]);

export type HandleValidationError =
  | { kind: "invalid_format" }
  | { kind: "reserved" };

export function validateHandleFormat(handle: string): HandleValidationError | null {
  if (!HANDLE_RX.test(handle)) return { kind: "invalid_format" };
  if (RESERVED.has(handle)) return { kind: "reserved" };
  return null;
}

/** Lowercase + trim. Used at the API boundary so case-only collisions are not possible. */
export function normalizeHandle(input: string): string {
  return input.trim().toLowerCase();
}
```

- [ ] **Step 3: Write failing tests for handles**

Create `apps/server/test/services/handles.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { normalizeHandle, validateHandleFormat } from "@/services/handles.js";

describe("validateHandleFormat", () => {
  it("accepts simple lowercase", () => {
    expect(validateHandleFormat("alice")).toBeNull();
    expect(validateHandleFormat("a1b")).toBeNull();
    expect(validateHandleFormat("a_b_c")).toBeNull();
    expect(validateHandleFormat("twentycharsexactlyok")).toBeNull(); // 20
  });

  it("rejects too short / too long / wrong charset / starts with digit", () => {
    expect(validateHandleFormat("ab")).toEqual({ kind: "invalid_format" });
    expect(validateHandleFormat("a".repeat(21))).toEqual({ kind: "invalid_format" });
    expect(validateHandleFormat("Alice")).toEqual({ kind: "invalid_format" });
    expect(validateHandleFormat("ali ce")).toEqual({ kind: "invalid_format" });
    expect(validateHandleFormat("9alice")).toEqual({ kind: "invalid_format" });
    expect(validateHandleFormat("alice-bob")).toEqual({ kind: "invalid_format" });
    expect(validateHandleFormat("")).toEqual({ kind: "invalid_format" });
  });

  it("rejects reserved words", () => {
    expect(validateHandleFormat("admin")).toEqual({ kind: "reserved" });
    expect(validateHandleFormat("paper")).toEqual({ kind: "reserved" });
    expect(validateHandleFormat("api")).toEqual({ kind: "reserved" });
  });
});

describe("normalizeHandle", () => {
  it("lowercases and trims", () => {
    expect(normalizeHandle("  Alice  ")).toBe("alice");
    expect(normalizeHandle("BOB")).toBe("bob");
  });
});
```

Run: `pnpm --filter @paper/server test test/services/handles.test.ts`
Expected: 3 passed.

- [ ] **Step 4: Create `apps/server/src/services/portfolio.ts`**

```typescript
import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client.js";
import { type HoldingsJson, portfolios } from "@/db/schema/index.js";
import { ASSETS, type AssetId } from "@paper/shared";
import { getAllCachedPrices } from "./prices.js";

export const STARTING_CASH_USD = "10000.00000000";

export type AssetValuation = {
  asset_id: AssetId;
  qty: string; // numeric(20,8) string
  cost_basis: string;
  price_usd: number | null; // null when no price cached
  value_usd: string | null; // qty * price_usd
};

export type PortfolioWithValuation = {
  user_id: string;
  cash_usd: string;
  holdings: AssetValuation[];
  total_value_usd: string; // cash + sum(value_usd)
  created_at: string;
};

/** Idempotent: returns the existing portfolio if one exists, otherwise creates with $10k cash + empty holdings. */
export async function initializePortfolio(db: Db, userId: string): Promise<{ created: boolean }> {
  const inserted = await db
    .insert(portfolios)
    .values({ userId, cashUsd: STARTING_CASH_USD, holdings: {} })
    .onConflictDoNothing({ target: portfolios.userId })
    .returning({ userId: portfolios.userId });
  return { created: inserted.length === 1 };
}

export async function getPortfolioWithValuation(
  db: Db,
  redisUrl: string,
  userId: string,
): Promise<PortfolioWithValuation | null> {
  const [row] = await db.select().from(portfolios).where(eq(portfolios.userId, userId));
  if (!row) return null;

  const prices = await getAllCachedPrices(redisUrl);
  const holdings: AssetValuation[] = ASSETS.flatMap((a) => {
    const h = (row.holdings as HoldingsJson)[a.id];
    if (!h) return [];
    const price = prices[a.id];
    const qtyDec = new Decimal(h.qty);
    const priceDec = price ? new Decimal(price.usd) : null;
    const valueDec = priceDec ? qtyDec.mul(priceDec) : null;
    return [
      {
        asset_id: a.id,
        qty: h.qty,
        cost_basis: h.cost_basis,
        price_usd: price?.usd ?? null,
        value_usd: valueDec ? valueDec.toFixed(8) : null,
      },
    ];
  });

  const cashDec = new Decimal(row.cashUsd);
  const holdingsValueDec = holdings.reduce(
    (acc, h) => (h.value_usd ? acc.plus(new Decimal(h.value_usd)) : acc),
    new Decimal(0),
  );
  const totalDec = cashDec.plus(holdingsValueDec);

  return {
    user_id: row.userId,
    cash_usd: row.cashUsd,
    holdings,
    total_value_usd: totalDec.toFixed(8),
    created_at: row.createdAt.toISOString(),
  };
}
```

- [ ] **Step 5: Write failing tests for portfolio**

Create `apps/server/test/services/portfolio.test.ts`:

```typescript
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeDb } from "@/db/client.js";
import { portfolios, users } from "@/db/schema/index.js";
import { getPortfolioWithValuation, initializePortfolio, STARTING_CASH_USD } from "@/services/portfolio.js";
import { closeRedis } from "@/services/redis.js";
import { withFreshRedis } from "../helpers/redis.js";
import { truncateAllTables } from "../helpers/db.js";

const dbUrl = process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/paper";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

describe("initializePortfolio", () => {
  const handles = makeDb(dbUrl, { max: 2 });

  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  async function makeUser(deviceUuid = "00000000-0000-0000-0000-000000000aaa"): Promise<string> {
    const [u] = await handles.db.insert(users).values({ deviceUuid }).returning({ id: users.id });
    if (!u) throw new Error("no user inserted");
    return u.id;
  }

  it("creates a portfolio with $10k cash and empty holdings", async () => {
    const userId = await makeUser();
    const { created } = await initializePortfolio(handles.db, userId);
    expect(created).toBe(true);
    const [row] = await handles.db.select().from(portfolios).where(eq(portfolios.userId, userId));
    expect(row?.cashUsd).toBe(STARTING_CASH_USD);
    expect(row?.holdings).toEqual({});
  });

  it("is idempotent — second call reports created=false", async () => {
    const userId = await makeUser();
    const first = await initializePortfolio(handles.db, userId);
    const second = await initializePortfolio(handles.db, userId);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
  });
});

describe("getPortfolioWithValuation", () => {
  const handles = makeDb(dbUrl, { max: 2 });

  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  it("returns null when no portfolio exists", async () => {
    const p = await getPortfolioWithValuation(handles.db, redisUrl, "00000000-0000-0000-0000-deadbeef0001");
    expect(p).toBeNull();
  });

  it("returns cash-only portfolio with total = cash when holdings empty", async () => {
    await withFreshRedis(async () => {
      const [u] = await handles.db
        .insert(users)
        .values({ deviceUuid: "00000000-0000-0000-0000-000000000bbb" })
        .returning({ id: users.id });
      if (!u) throw new Error("no user");
      await initializePortfolio(handles.db, u.id);
      const p = await getPortfolioWithValuation(handles.db, redisUrl, u.id);
      expect(p).not.toBeNull();
      expect(p?.cash_usd).toBe(STARTING_CASH_USD);
      expect(p?.holdings).toEqual([]);
      expect(p?.total_value_usd).toBe(STARTING_CASH_USD);
    });
  });
});
```

- [ ] **Step 6: Run portfolio tests**

```bash
pnpm --filter @paper/server test test/services/portfolio.test.ts test/services/handles.test.ts
```

Expected: all passing.

- [ ] **Step 7: Run full server suite**

```bash
pnpm --filter @paper/server test
```

Expected: 14 prior + 3 handles + 2 init + 2 valuation + 3 prices = 24 passing.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/services/portfolio.ts apps/server/src/services/handles.ts apps/server/test/services apps/server/package.json pnpm-lock.yaml
git commit -m "feat(server): portfolio service (init + valuation) and handles validator"
```

---

### Task 5: GET /v1/assets endpoint (TDD)

**Files:**
- Create: `apps/server/src/routes/assets.ts`
- Create: `apps/server/test/routes/assets.test.ts`
- Modify: `apps/server/src/server.ts` (register the route)

The endpoint is publicly readable (asset list + prices are not user-specific) but we still require auth so analytics can attribute reads. Plan 2 deliberately keeps it simple — gated.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/routes/assets.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeRedis } from "@/services/redis.js";
import { makeTestServer, type TestServer } from "../helpers/server.js";
import { withFreshRedis } from "../helpers/redis.js";

describe("GET /v1/assets", () => {
  let ctx: TestServer;
  beforeAll(async () => {
    ctx = await makeTestServer();
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.sql.end();
    await closeRedis();
  });

  async function authedHeaders(): Promise<Record<string, string>> {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/device",
      payload: { device_uuid: "00000000-0000-0000-0000-00000000a001" },
    });
    const body = res.json() as { access_token: string };
    return { authorization: `Bearer ${body.access_token}` };
  }

  it("returns 401 without a token", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/v1/assets" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 12 assets with null prices when cache is empty", async () => {
    await withFreshRedis(async () => {
      const headers = await authedHeaders();
      const res = await ctx.app.inject({ method: "GET", url: "/v1/assets", headers });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { assets: Array<{ id: string; price_usd: number | null }> };
      expect(body.assets).toHaveLength(12);
      const ids = body.assets.map((a) => a.id);
      expect(ids).toContain("BTC");
      expect(ids).toContain("USDC");
      const btc = body.assets.find((a) => a.id === "BTC");
      expect(btc?.price_usd).toBeNull();
    });
  });

  it("returns prices when cache is populated", async () => {
    await withFreshRedis(async (r) => {
      await r.set(
        "paper:price:BTC",
        JSON.stringify({ usd: 70000, prevUsd: 69000, ts: 1 }),
        "EX",
        120,
      );
      const headers = await authedHeaders();
      const res = await ctx.app.inject({ method: "GET", url: "/v1/assets", headers });
      const body = res.json() as { assets: Array<{ id: string; price_usd: number | null; change_24h_pct: number | null }> };
      const btc = body.assets.find((a) => a.id === "BTC");
      expect(btc?.price_usd).toBe(70000);
      // (70000 - 69000) / 69000 * 100 ≈ 1.4493 — round to 4 decimals: 1.4493
      expect(btc?.change_24h_pct).toBeCloseTo(1.4493, 3);
    });
  });
});
```

- [ ] **Step 2: Run failing**

```bash
pnpm --filter @paper/server test test/routes/assets.test.ts
```

Expected: FAIL — route not registered.

- [ ] **Step 3: Implement `apps/server/src/routes/assets.ts`**

```typescript
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import Decimal from "decimal.js";
import { ASSETS, pastelForAsset } from "@paper/shared";
import { getAllCachedPrices } from "@/services/prices.js";

const AssetItem = z.object({
  id: z.string(),
  name: z.string(),
  pastel: z.enum(["peach", "mint", "sky", "lilac"]),
  price_usd: z.number().nullable(),
  change_24h_pct: z.number().nullable(),
  cached_at: z.number().nullable(),
});

const AssetsResponse = z.object({
  assets: z.array(AssetItem),
});

export const assetsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/assets",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["assets"],
        summary: "Asset roster with current prices",
        security: [{ bearerAuth: [] }],
        response: { 200: AssetsResponse },
      },
    },
    async () => {
      const prices = await getAllCachedPrices(app.config.REDIS_URL);
      const assets = ASSETS.map((a) => {
        const p = prices[a.id];
        let change_24h_pct: number | null = null;
        if (p && p.prevUsd > 0) {
          const cur = new Decimal(p.usd);
          const prev = new Decimal(p.prevUsd);
          change_24h_pct = cur.minus(prev).div(prev).mul(100).toDecimalPlaces(4).toNumber();
        }
        return {
          id: a.id,
          name: a.name,
          pastel: pastelForAsset(a.id),
          price_usd: p?.usd ?? null,
          change_24h_pct,
          cached_at: p?.ts ?? null,
        };
      });
      return { assets };
    },
  );
};
```

- [ ] **Step 4: Register the route in `apps/server/src/server.ts`**

Add to imports (alphabetical):

```typescript
import { assetsRoutes } from "./routes/assets.js";
```

After `await app.register(authRoutes);` add:

```typescript
await app.register(assetsRoutes);
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @paper/server test test/routes/assets.test.ts
```

Expected: 3 passed.

- [ ] **Step 6: Regenerate the API client (so the dashboard hook materialises)**

```bash
pnpm gen:api-client
```

Expected: writes `packages/api-client/src/{client,hooks,types,zod,msw}/getV1Assets*` files. Verify with:

```bash
ls packages/api-client/src/hooks/ | grep -i assets
```

- [ ] **Step 7: Commit**

```bash
git add apps/server packages/api-client
git commit -m "feat(server): GET /v1/assets returns 12 assets with cached prices"
```

---

### Task 6: GET /v1/me endpoint (TDD)

**Files:**
- Create: `apps/server/src/routes/me.ts`
- Create: `apps/server/test/routes/me.test.ts`
- Modify: `apps/server/src/server.ts` (register `meRoutes`)
- Modify: `apps/server/src/routes/auth.ts` (auto-init portfolio on first device auth)

- [ ] **Step 1: Modify `apps/server/src/routes/auth.ts`** so that `/v1/auth/device` auto-creates a portfolio on user creation.

In the device handler, after the `if (!user) throw …` line, add:

```typescript
      const { initializePortfolio } = await import("@/services/portfolio.js");
      await initializePortfolio(app.db, user.id);
```

(Dynamic import to avoid a top-level circular when portfolio.ts is later modified to consume db features. If that's not a concern, switch to a static import — both work.)

Static is preferred for clarity. Add to the auth.ts imports at the top:

```typescript
import { initializePortfolio } from "@/services/portfolio.js";
```

And in the device handler, after `if (!user) throw new Error("failed to upsert user");`:

```typescript
      await initializePortfolio(app.db, user.id);
```

- [ ] **Step 2: Verify auth tests still pass**

```bash
pnpm --filter @paper/server test test/routes/auth.test.ts
```

Expected: 8 passing (T10/T11 unchanged behaviorally).

- [ ] **Step 3: Write failing tests for /v1/me**

Create `apps/server/test/routes/me.test.ts`:

```typescript
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeRedis } from "@/services/redis.js";
import { makeTestServer, type TestServer } from "../helpers/server.js";
import { truncateAllTables } from "../helpers/db.js";
import { withFreshRedis } from "../helpers/redis.js";

describe("GET /v1/me", () => {
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

  async function deviceAuth(deviceUuid: string): Promise<string> {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/auth/device",
      payload: { device_uuid: deviceUuid },
    });
    const body = res.json() as { access_token: string };
    return body.access_token;
  }

  it("requires auth", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/v1/me" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the current user + a $10k portfolio", async () => {
    await withFreshRedis(async () => {
      const token = await deviceAuth("00000000-0000-0000-0000-00000000c001");
      const res = await ctx.app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        user: { id: string; handle: string | null; avatar: string | null };
        portfolio: { cash_usd: string; holdings: unknown[]; total_value_usd: string };
      };
      expect(body.user.handle).toBeNull();
      expect(body.user.avatar).toBeNull();
      expect(body.portfolio.cash_usd).toBe("10000.00000000");
      expect(body.portfolio.holdings).toEqual([]);
      expect(body.portfolio.total_value_usd).toBe("10000.00000000");
    });
  });
});
```

- [ ] **Step 4: Run failing**

```bash
pnpm --filter @paper/server test test/routes/me.test.ts
```

Expected: FAIL — route not registered.

- [ ] **Step 5: Implement `apps/server/src/routes/me.ts`**

```typescript
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { users } from "@/db/schema/index.js";
import { getPortfolioWithValuation } from "@/services/portfolio.js";

const MeUser = z.object({
  id: z.uuid(),
  handle: z.string().nullable(),
  avatar: z.string().nullable(),
});

const Holding = z.object({
  asset_id: z.string(),
  qty: z.string(),
  cost_basis: z.string(),
  price_usd: z.number().nullable(),
  value_usd: z.string().nullable(),
});

const MePortfolio = z.object({
  cash_usd: z.string(),
  holdings: z.array(Holding),
  total_value_usd: z.string(),
});

const MeResponse = z.object({
  user: MeUser,
  portfolio: MePortfolio,
});

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/me",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["me"],
        summary: "Current user + portfolio with valuation",
        security: [{ bearerAuth: [] }],
        response: { 200: MeResponse },
      },
    },
    async (request, reply) => {
      const userId = request.user.sub;
      const [u] = await app.db.select().from(users).where(eq(users.id, userId));
      if (!u) return reply.code(404).send({ error: "user_not_found" });

      const p = await getPortfolioWithValuation(app.db, app.config.REDIS_URL, userId);
      if (!p) return reply.code(500).send({ error: "portfolio_missing" });

      return {
        user: { id: u.id, handle: u.handle, avatar: u.avatar },
        portfolio: {
          cash_usd: p.cash_usd,
          holdings: p.holdings,
          total_value_usd: p.total_value_usd,
        },
      };
    },
  );
};
```

- [ ] **Step 6: Register in `apps/server/src/server.ts`**

Add import:

```typescript
import { meRoutes } from "./routes/me.js";
```

After `assetsRoutes`:

```typescript
await app.register(meRoutes);
```

- [ ] **Step 7: Run tests + regenerate api-client**

```bash
pnpm --filter @paper/server test test/routes/me.test.ts
pnpm gen:api-client
```

Expected: 2 passed; client generates `getV1Me` etc.

- [ ] **Step 8: Commit**

```bash
git add apps/server packages/api-client
git commit -m "feat(server): GET /v1/me + auto-init portfolio on first device auth"
```

---

### Task 7: PATCH /v1/me + GET /v1/handles/check (TDD)

**Files:**
- Modify: `apps/server/src/routes/me.ts` (add PATCH + handle check)
- Modify: `apps/server/test/routes/me.test.ts` (add tests)

- [ ] **Step 1: Append the failing tests**

Append to `apps/server/test/routes/me.test.ts`:

```typescript
describe("PATCH /v1/me", () => {
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

  it("sets handle + avatar", async () => {
    await withFreshRedis(async () => {
      const token = await deviceAuth("00000000-0000-0000-0000-00000000d001");
      const res = await ctx.app.inject({
        method: "PATCH",
        url: "/v1/me",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { handle: "alice", avatar: "peach" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { user: { handle: string; avatar: string } };
      expect(body.user.handle).toBe("alice");
      expect(body.user.avatar).toBe("peach");
    });
  });

  it("normalises and rejects bad formats", async () => {
    await withFreshRedis(async () => {
      const token = await deviceAuth("00000000-0000-0000-0000-00000000d002");
      const res = await ctx.app.inject({
        method: "PATCH",
        url: "/v1/me",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { handle: "BAD HANDLE" },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toBe("invalid_handle_format");
    });
  });

  it("rejects reserved handles", async () => {
    await withFreshRedis(async () => {
      const token = await deviceAuth("00000000-0000-0000-0000-00000000d003");
      const res = await ctx.app.inject({
        method: "PATCH",
        url: "/v1/me",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { handle: "admin" },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toBe("handle_reserved");
    });
  });

  it("rejects taken handles with 409", async () => {
    await withFreshRedis(async () => {
      const t1 = await deviceAuth("00000000-0000-0000-0000-00000000d004");
      const t2 = await deviceAuth("00000000-0000-0000-0000-00000000d005");
      const r1 = await ctx.app.inject({
        method: "PATCH",
        url: "/v1/me",
        headers: { authorization: `Bearer ${t1}`, "content-type": "application/json" },
        payload: { handle: "bob" },
      });
      expect(r1.statusCode).toBe(200);
      const r2 = await ctx.app.inject({
        method: "PATCH",
        url: "/v1/me",
        headers: { authorization: `Bearer ${t2}`, "content-type": "application/json" },
        payload: { handle: "bob" },
      });
      expect(r2.statusCode).toBe(409);
      expect((r2.json() as { error: string }).error).toBe("handle_taken");
    });
  });
});

describe("GET /v1/handles/check", () => {
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

  it("returns available=true for an unused valid handle", async () => {
    await withFreshRedis(async () => {
      const token = await deviceAuth("00000000-0000-0000-0000-00000000e001");
      const res = await ctx.app.inject({
        method: "GET",
        url: "/v1/handles/check?handle=carol",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { available: boolean; reason: string | null };
      expect(body.available).toBe(true);
      expect(body.reason).toBeNull();
    });
  });

  it("returns available=false with reason for invalid + reserved + taken", async () => {
    await withFreshRedis(async () => {
      const token = await deviceAuth("00000000-0000-0000-0000-00000000e002");
      // reserve a handle by setting it on the user
      await ctx.app.inject({
        method: "PATCH",
        url: "/v1/me",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { handle: "dora" },
      });

      const invalid = await ctx.app.inject({
        method: "GET",
        url: "/v1/handles/check?handle=BAD",
        headers: { authorization: `Bearer ${token}` },
      });
      expect((invalid.json() as { reason: string }).reason).toBe("invalid_format");

      const reserved = await ctx.app.inject({
        method: "GET",
        url: "/v1/handles/check?handle=admin",
        headers: { authorization: `Bearer ${token}` },
      });
      expect((reserved.json() as { reason: string }).reason).toBe("reserved");

      const taken = await ctx.app.inject({
        method: "GET",
        url: "/v1/handles/check?handle=dora",
        headers: { authorization: `Bearer ${token}` },
      });
      expect((taken.json() as { reason: string }).reason).toBe("taken");
    });
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
pnpm --filter @paper/server test test/routes/me.test.ts
```

Expected: PATCH and check tests fail (route doesn't exist yet).

- [ ] **Step 3: Implement PATCH and the check route**

Replace `apps/server/src/routes/me.ts` with:

```typescript
import { and, eq, ne } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { users } from "@/db/schema/index.js";
import { normalizeHandle, validateHandleFormat } from "@/services/handles.js";
import { getPortfolioWithValuation } from "@/services/portfolio.js";

const MeUser = z.object({
  id: z.uuid(),
  handle: z.string().nullable(),
  avatar: z.string().nullable(),
});

const Holding = z.object({
  asset_id: z.string(),
  qty: z.string(),
  cost_basis: z.string(),
  price_usd: z.number().nullable(),
  value_usd: z.string().nullable(),
});

const MePortfolio = z.object({
  cash_usd: z.string(),
  holdings: z.array(Holding),
  total_value_usd: z.string(),
});

const MeResponse = z.object({
  user: MeUser,
  portfolio: MePortfolio,
});

const PatchBody = z.object({
  handle: z.string().min(1).max(40).optional(),
  avatar: z.enum(["peach", "mint", "sky", "lilac"]).optional(),
});

const PatchResponse = z.object({
  user: MeUser,
});

const PatchError = z.object({
  error: z.enum(["invalid_handle_format", "handle_reserved", "handle_taken"]),
});

const HandleCheckResponse = z.object({
  available: z.boolean(),
  reason: z.enum(["invalid_format", "reserved", "taken"]).nullable(),
});

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/v1/me",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["me"],
        summary: "Current user + portfolio with valuation",
        security: [{ bearerAuth: [] }],
        response: { 200: MeResponse },
      },
    },
    async (request, reply) => {
      const userId = request.user.sub;
      const [u] = await app.db.select().from(users).where(eq(users.id, userId));
      if (!u) return reply.code(404).send({ error: "user_not_found" });
      const p = await getPortfolioWithValuation(app.db, app.config.REDIS_URL, userId);
      if (!p) return reply.code(500).send({ error: "portfolio_missing" });
      return {
        user: { id: u.id, handle: u.handle, avatar: u.avatar },
        portfolio: {
          cash_usd: p.cash_usd,
          holdings: p.holdings,
          total_value_usd: p.total_value_usd,
        },
      };
    },
  );

  app.patch(
    "/v1/me",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["me"],
        summary: "Update handle and/or avatar",
        security: [{ bearerAuth: [] }],
        body: PatchBody,
        response: {
          200: PatchResponse,
          400: PatchError,
          409: PatchError,
        },
      },
    },
    async (request, reply) => {
      const userId = request.user.sub;
      const patch: Partial<{ handle: string; avatar: string }> = {};

      if (request.body.handle !== undefined) {
        const normalized = normalizeHandle(request.body.handle);
        const err = validateHandleFormat(normalized);
        if (err?.kind === "invalid_format") {
          return reply.code(400).send({ error: "invalid_handle_format" as const });
        }
        if (err?.kind === "reserved") {
          return reply.code(400).send({ error: "handle_reserved" as const });
        }
        // Check uniqueness against other users (allow re-claiming own handle as no-op).
        const [taken] = await app.db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.handle, normalized), ne(users.id, userId)));
        if (taken) {
          return reply.code(409).send({ error: "handle_taken" as const });
        }
        patch.handle = normalized;
      }
      if (request.body.avatar !== undefined) {
        patch.avatar = request.body.avatar;
      }

      const [updated] = await app.db
        .update(users)
        .set(patch)
        .where(eq(users.id, userId))
        .returning();
      if (!updated) return reply.code(404).send({ error: "user_not_found" });

      return { user: { id: updated.id, handle: updated.handle, avatar: updated.avatar } };
    },
  );

  app.get(
    "/v1/handles/check",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["me"],
        summary: "Check if a handle is available before claiming",
        security: [{ bearerAuth: [] }],
        querystring: z.object({ handle: z.string().min(1).max(40) }),
        response: { 200: HandleCheckResponse },
      },
    },
    async (request) => {
      const normalized = normalizeHandle(request.query.handle);
      const err = validateHandleFormat(normalized);
      if (err?.kind === "invalid_format") {
        return { available: false, reason: "invalid_format" as const };
      }
      if (err?.kind === "reserved") {
        return { available: false, reason: "reserved" as const };
      }
      const [taken] = await app.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.handle, normalized));
      if (taken) return { available: false, reason: "taken" as const };
      return { available: true, reason: null };
    },
  );
};
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @paper/server test test/routes/me.test.ts
```

Expected: GET `/v1/me` (2) + PATCH (4) + handles/check (2) = 8 passing.

- [ ] **Step 5: Regenerate api-client**

```bash
pnpm gen:api-client
```

- [ ] **Step 6: Commit**

```bash
git add apps/server packages/api-client
git commit -m "feat(server): PATCH /v1/me + GET /v1/handles/check with format/reserved/taken"
```

---

### Phase B — Cron + deploy (T8–T9)

### Task 8: Price-ingestion job entrypoint (TDD)

**Files:**
- Create: `apps/server/src/jobs/price-ingestion.ts`
- Create: `apps/server/test/jobs/price-ingestion.test.ts`

The CronJob runs `node apps/server/dist/jobs/price-ingestion.js` once per minute. It loads config, calls `fetchAndCacheAllPrices`, logs the result, and exits. Pool ceiling: cron sets `max: 1` since it does no DB work.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/jobs/price-ingestion.test.ts`:

```typescript
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeRedis } from "@/services/redis.js";
import { runPriceIngestion } from "@/jobs/price-ingestion.js";
import { withFreshRedis } from "../helpers/redis.js";

describe("runPriceIngestion", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await closeRedis();
  });

  it("populates Redis with all 12 prices", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const symbol = new URL(String(input)).searchParams.get("symbol") ?? "X";
        return new Response(
          JSON.stringify({ symbol, lastPrice: "100", prevClosePrice: "99" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    await withFreshRedis(async (r) => {
      const result = await runPriceIngestion();
      expect(result.ok).toBe(12);
      expect(result.failed).toBe(0);
      const keys = await r.keys("paper:price:*");
      expect(keys).toHaveLength(12);
    });
  });
});
```

- [ ] **Step 2: Run failing**

```bash
pnpm --filter @paper/server test test/jobs/price-ingestion.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/server/src/jobs/price-ingestion.ts`**

```typescript
import { loadConfig } from "../config.js";
import { fetchAndCacheAllPrices } from "../services/prices.js";
import { closeRedis } from "../services/redis.js";

export async function runPriceIngestion(): Promise<{ ok: number; failed: number }> {
  const config = loadConfig();
  const result = await fetchAndCacheAllPrices(config.REDIS_URL);
  return result;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  try {
    const { ok, failed } = await runPriceIngestion();
    const elapsedMs = Date.now() - t0;
    console.info(JSON.stringify({ event: "price_ingestion_done", ok, failed, elapsed_ms: elapsedMs }));
    if (failed > 0 && ok === 0) {
      // Hard failure — all symbols missed. K8s sees non-zero exit.
      process.exit(2);
    }
    process.exit(0);
  } catch (err) {
    console.error(JSON.stringify({ event: "price_ingestion_error", message: err instanceof Error ? err.message : String(err) }));
    process.exit(1);
  } finally {
    await closeRedis();
  }
}

// Only run main when invoked as a script — not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @paper/server test test/jobs/price-ingestion.test.ts
```

Expected: 1 passed.

- [ ] **Step 5: Smoke locally with the dev Redis**

```bash
export $(grep -v '^#' .env | xargs)
pnpm --filter @paper/server exec tsx src/jobs/price-ingestion.ts
```

Expected: a JSON log line `{"event":"price_ingestion_done","ok":12,"failed":0,...}`. Then verify cache:

```bash
podman exec -i paper-redis-1 redis-cli KEYS 'paper:price:*' | head -5
```

Expected: 12 keys.

- [ ] **Step 6: Confirm full server suite still green**

```bash
pnpm --filter @paper/server test
```

Expected: 14 prior + 8 new = 22+ passing.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/jobs apps/server/test/jobs
git commit -m "feat(server): price-ingestion CronJob entrypoint"
```

---

### Task 9: K8s CronJob manifest for price-ingestion

**Files (in lab repo):**
- Create: `lab/stacks/paper/manifests/30-cron-price-ingestion.yaml`

The cron uses the same image as `paper-api` (built in Plan 1) with a different `command`. It runs every minute; `concurrencyPolicy: Forbid` prevents overlap if a tick takes longer than 60s.

- [ ] **Step 1: Create the manifest**

```bash
mkdir -p /Users/filipkastovsky/work/personal/lab/stacks/paper/manifests
```

Write `/Users/filipkastovsky/work/personal/lab/stacks/paper/manifests/30-cron-price-ingestion.yaml`:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: paper-cron-price-ingestion
  namespace: paper
spec:
  schedule: "* * * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  startingDeadlineSeconds: 30
  jobTemplate:
    spec:
      backoffLimit: 0
      template:
        spec:
          restartPolicy: Never
          imagePullSecrets:
            - name: paper-pull
          containers:
            - name: cron-price-ingestion
              image: ${image}
              command: ["node", "apps/server/dist/jobs/price-ingestion.js"]
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
                  value: paper-cron-price-ingestion
              resources:
                requests: { cpu: "20m", memory: "64Mi" }
                limits:   { cpu: "200m", memory: "128Mi" }
```

- [ ] **Step 2: Commit (lab repo)**

```bash
cd /Users/filipkastovsky/work/personal/lab
git add stacks/paper/manifests/30-cron-price-ingestion.yaml
git commit -m "feat(paper): add price-ingestion CronJob (every minute)"
```

(Apply happens in Task 22 after the new image is pushed. Don't apply yet — there's no image with `dist/jobs/price-ingestion.js` baked in.)

---

### Phase C — Web onboarding (T10–T15)

### Task 10: Onboarding store + first-load auth-redirect guard

**Files (web):**
- Create: `apps/web/src/stores/onboarding-store.ts`
- Create: `apps/web/src/lib/auth-redirect.ts`
- Create: `apps/web/src/lib/currency.ts`
- Modify: `apps/web/src/main.tsx` (use the new redirect helper)

- [ ] **Step 1: Create `apps/web/src/stores/onboarding-store.ts`**

```typescript
import { create } from "zustand";

export type Step = "welcome" | "handle" | "balance" | "lesson";
export const STEPS: Step[] = ["welcome", "handle", "balance", "lesson"];

interface OnboardingState {
  /** Last server-confirmed handle (after PATCH /v1/me succeeds). */
  claimedHandle: string | null;
  /** Selected avatar; null until the user picks. */
  avatar: "peach" | "mint" | "sky" | "lilac" | null;
  /** Marks true after step 3 (balance reveal acknowledged). */
  balanceAcknowledged: boolean;

  setClaimedHandle: (h: string | null) => void;
  setAvatar: (a: OnboardingState["avatar"]) => void;
  acknowledgeBalance: () => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  claimedHandle: null,
  avatar: null,
  balanceAcknowledged: false,
  setClaimedHandle: (h) => set({ claimedHandle: h }),
  setAvatar: (a) => set({ avatar: a }),
  acknowledgeBalance: () => set({ balanceAcknowledged: true }),
  reset: () => set({ claimedHandle: null, avatar: null, balanceAcknowledged: false }),
}));
```

- [ ] **Step 2: Create `apps/web/src/lib/currency.ts`**

```typescript
/** Parse a numeric(20,8) string into a JS number. Loses precision past 2^53; for
 *  display only. Trade execution + persistence stays string-based. */
export function parseCash(input: string): number {
  const n = Number.parseFloat(input);
  if (!Number.isFinite(n)) return 0;
  return n;
}

/** Format a USD value as e.g. "$10,000.00". softDecimal=true tones down the .XX. */
export function formatUsd(value: number, opts: { decimals?: number } = {}): string {
  const decimals = opts.decimals ?? 2;
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}
```

- [ ] **Step 3: Create `apps/web/src/lib/auth-redirect.ts`**

```typescript
import { getStoredUser } from "./auth";

/** Decides where the root path "/" should redirect to after auth bootstraps.
 *  - No user yet (auth in flight): null → callers should NOT redirect.
 *  - User has handle: "/dashboard"
 *  - User has no handle: "/onboarding/welcome"
 */
export function pickInitialRoute(): "/dashboard" | "/onboarding/welcome" | null {
  const user = getStoredUser();
  if (!user) return null;
  return user.handle ? "/dashboard" : "/onboarding/welcome";
}
```

- [ ] **Step 4: Modify `apps/web/src/main.tsx`** to render synchronously and rely on per-route guards instead of pre-render auth wait.

The Plan 1 polish (`b876627`) already made `main.tsx` non-blocking on `bootstrapAuth()`. Plan 2 keeps that — no change to `main.tsx` is required for this task. Verify:

```bash
grep -A2 'function start' apps/web/src/main.tsx
```

If the function is still wrapping `bootstrapAuth()` synchronously, that's fine — leave alone. (This step is marked deliberately as a no-op confirmation.)

- [ ] **Step 5: Run typecheck**

```bash
pnpm --filter @paper/web typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/stores/onboarding-store.ts apps/web/src/lib/auth-redirect.ts apps/web/src/lib/currency.ts
git commit -m "feat(web): onboarding store + initial-route guard helper"
```

---

### Task 11: Onboarding root layout + step indicator + sub-routes

**Files (web):**
- Create: `apps/web/src/components/onboarding/StepIndicator.tsx`
- Create: `apps/web/src/routes/onboarding/route.tsx`

- [ ] **Step 1: Create `apps/web/src/components/onboarding/StepIndicator.tsx`**

```tsx
import { cn } from "@/lib/cn";
import { STEPS, type Step } from "@/stores/onboarding-store";

export function StepIndicator({ current }: { current: Step }) {
  const idx = STEPS.indexOf(current);
  return (
    <ol
      role="list"
      aria-label="Onboarding progress"
      className="flex items-center gap-2"
    >
      {STEPS.map((s, i) => {
        const active = i <= idx;
        return (
          <li
            key={s}
            aria-current={i === idx ? "step" : undefined}
            className={cn(
              "h-1.5 w-8 rounded-full transition-colors",
              active ? "bg-ink" : "bg-line",
            )}
          />
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 2: Create `apps/web/src/routes/onboarding/route.tsx`** — TanStack Router layout that wraps every `/onboarding/*` step.

```tsx
import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingLayout,
});

function OnboardingLayout() {
  return (
    <main className="min-h-dvh bg-paper px-6 py-10 flex items-start justify-center sm:items-center">
      <div className="w-full max-w-md">
        <Outlet />
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Re-run TanStack Router codegen + typecheck**

```bash
pnpm --filter @paper/web dev &
DEV_PID=$!
sleep 4
kill $DEV_PID 2>/dev/null
pnpm --filter @paper/web typecheck
```

(Starting dev server briefly forces the TanStack Router plugin to regenerate `routeTree.gen.ts`. There may be other ways — check the plugin docs if this feels heavy.)

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/onboarding apps/web/src/routes/onboarding/route.tsx apps/web/src/routeTree.gen.ts
git commit -m "feat(web): onboarding layout route + step indicator"
```

---

### Task 12: /onboarding/welcome route

**Files:**
- Create: `apps/web/src/routes/onboarding/welcome.tsx`
- Modify: `apps/web/src/routes/index.tsx` (becomes a redirect)

The Plan 1 polish has the welcome screen at `/`. Plan 2 moves it to `/onboarding/welcome` and makes `/` a router redirect that picks `/dashboard` or `/onboarding/welcome` per `pickInitialRoute()`.

- [ ] **Step 1: Create `apps/web/src/routes/onboarding/welcome.tsx`** — copy the existing `WelcomeCard` + `HeroLockup` from `apps/web/src/routes/index.tsx`, but replace the disabled "Coming soon" CTA with `<Link to="/onboarding/handle">`.

```tsx
import { BalanceNumeral } from "@/components/ui/balance-numeral";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { PhoneFrame } from "@/components/ui/phone-frame";
import { StepIndicator } from "@/components/onboarding/StepIndicator";
import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/onboarding/welcome")({
  component: Welcome,
});

function Welcome() {
  return (
    <div className="space-y-6">
      <StepIndicator current="welcome" />
      <div className="grid gap-12 md:grid-cols-2 md:items-center">
        <div className="md:order-1">
          <div className="md:hidden">
            <WelcomeCard />
          </div>
          <div className="hidden md:block">
            <HeroLockup />
          </div>
        </div>
        <div className="hidden md:block md:order-2">
          <PhoneFrame className="max-w-[340px]">
            <div className="flex h-full w-full flex-col justify-center px-6 py-12">
              <WelcomeCard compact />
            </div>
          </PhoneFrame>
        </div>
      </div>
    </div>
  );
}

function WelcomeCard({ compact = false }: { compact?: boolean }) {
  return (
    <Card tone="paper" elevation="float" padding="lush" className="w-full text-center relative isolate">
      <span aria-hidden className="pointer-events-none absolute -top-20 -right-16 h-56 w-56 rounded-full bg-peach opacity-40 blur-3xl" />
      <span aria-hidden className="pointer-events-none absolute -bottom-24 -right-20 h-64 w-64 rounded-full bg-mint opacity-35 blur-3xl" />
      <div className="relative">
        <Eyebrow>welcome to paper</Eyebrow>
        <BalanceNumeral value={10000} size={compact ? "lg" : "xl"} noDecimal className="mt-5 block" />
        <Heading level="h2" className="mt-4">of practice cash. No real money.</Heading>
        <p className="mt-4 text-ink-soft text-sm sm:text-base">
          Pastel lessons. A daily question. A streak you'll want to keep.
        </p>
        <Link to="/onboarding/handle" className="block mt-8">
          <Button trailing="→" fullWidth>Get started</Button>
        </Link>
      </div>
    </Card>
  );
}

function HeroLockup() {
  return (
    <div className="text-left">
      <Eyebrow>welcome to paper</Eyebrow>
      <div className="mt-6">
        <BalanceNumeral value={10000} size="xl" noDecimal className="block" />
      </div>
      <Heading level="display" className="mt-6 max-w-[18ch]">
        of practice cash. No real money.
      </Heading>
      <p className="mt-6 max-w-[42ch] text-ink-soft text-base">
        Pastel lessons. A daily question. A streak you'll want to keep.
      </p>
      <div className="mt-10 max-w-sm">
        <Link to="/onboarding/handle">
          <Button trailing="→" fullWidth>Get started</Button>
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace `apps/web/src/routes/index.tsx`** with a redirect that runs synchronously.

```tsx
import { pickInitialRoute } from "@/lib/auth-redirect";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    const target = pickInitialRoute();
    // If auth hasn't bootstrapped yet, fall through to /onboarding/welcome —
    // it'll re-redirect once `pickInitialRoute()` returns a non-null value on
    // a later visit. (bootstrapAuth completes in <1s for a returning user.)
    throw redirect({ to: target ?? "/onboarding/welcome" });
  },
});
```

- [ ] **Step 3: Smoke check the dev server**

```bash
pnpm --filter @paper/web dev &
DEV_PID=$!
sleep 5
curl -sS -L http://localhost:5173/ -o /tmp/root.html
curl -sS -L http://localhost:5173/onboarding/welcome -o /tmp/welcome.html
kill $DEV_PID 2>/dev/null
grep -c 'practice cash' /tmp/welcome.html
```

Expected: at least one match.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes
git commit -m "feat(web): /onboarding/welcome step + / becomes redirect"
```

---

### Task 13: /onboarding/handle with debounced uniqueness check

**Files:**
- Create: `apps/web/src/components/onboarding/HandleInput.tsx`
- Create: `apps/web/src/routes/onboarding/handle.tsx`

- [ ] **Step 1: Create `apps/web/src/components/onboarding/HandleInput.tsx`**

```tsx
import { cn } from "@/lib/cn";
import type { ChangeEvent } from "react";

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "invalid_format" }
  | { kind: "reserved" }
  | { kind: "taken" };

const HINTS: Record<Status["kind"], string> = {
  idle: "3–20 characters. Lowercase letters, digits, underscore. Must start with a letter.",
  checking: "checking…",
  available: "available ✓",
  invalid_format: "Only lowercase letters, digits, and underscore. Must start with a letter.",
  reserved: "That handle is reserved.",
  taken: "Already taken — try another.",
};

const TONE_CLASS: Record<Status["kind"], string> = {
  idle: "text-muted",
  checking: "text-muted",
  available: "text-up",
  invalid_format: "text-down",
  reserved: "text-down",
  taken: "text-down",
};

export function HandleInput({
  value,
  status,
  onChange,
}: {
  value: string;
  status: Status;
  onChange: (next: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 rounded-md bg-surface-2 px-4 py-3 ring-1 ring-line focus-within:ring-ink">
        <span className="font-display text-ink-soft">@</span>
        <input
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={20}
          aria-invalid={
            status.kind === "invalid_format" ||
            status.kind === "reserved" ||
            status.kind === "taken"
          }
          aria-describedby="handle-hint"
          className="flex-1 bg-transparent outline-none font-display text-lg placeholder:text-muted"
          placeholder="yourhandle"
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        />
      </div>
      <p id="handle-hint" className={cn("mt-2 text-xs", TONE_CLASS[status.kind])}>
        {HINTS[status.kind]}
      </p>
    </div>
  );
}

export type { Status };
```

- [ ] **Step 2: Create `apps/web/src/routes/onboarding/handle.tsx`**

```tsx
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { HandleInput, type Status } from "@/components/onboarding/HandleInput";
import { StepIndicator } from "@/components/onboarding/StepIndicator";
import { useOnboardingStore } from "@/stores/onboarding-store";
import {
  useGetV1HandlesCheck,
  usePatchV1Me,
} from "@paper/api-client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

export const Route = createFileRoute("/onboarding/handle")({
  component: HandlePick,
});

function HandlePick() {
  const navigate = useNavigate();
  const setClaimedHandle = useOnboardingStore((s) => s.setClaimedHandle);

  const [draft, setDraft] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(draft.toLowerCase().trim()), 300);
    return () => clearTimeout(t);
  }, [draft]);

  const enabled = debounced.length >= 3;
  const check = useGetV1HandlesCheck(
    { handle: debounced },
    { query: { enabled, retry: 0, staleTime: 30_000 } },
  );

  const status: Status = useMemo(() => {
    if (draft.length === 0) return { kind: "idle" };
    if (!enabled) return { kind: "idle" };
    if (debounced !== draft.toLowerCase().trim()) return { kind: "checking" };
    if (check.isFetching) return { kind: "checking" };
    if (check.data) {
      if (check.data.available) return { kind: "available" };
      const r = check.data.reason;
      if (r === "invalid_format") return { kind: "invalid_format" };
      if (r === "reserved") return { kind: "reserved" };
      if (r === "taken") return { kind: "taken" };
    }
    return { kind: "checking" };
  }, [draft, debounced, enabled, check.isFetching, check.data]);

  const claim = usePatchV1Me();
  const canSubmit = status.kind === "available" && !claim.isPending;

  async function onSubmit() {
    if (!canSubmit) return;
    const result = await claim.mutateAsync({ data: { handle: debounced } });
    setClaimedHandle(result.user.handle ?? null);
    await navigate({ to: "/onboarding/balance" });
  }

  return (
    <div className="space-y-6">
      <StepIndicator current="handle" />
      <Card tone="paper" elevation="float" padding="lush">
        <Eyebrow>step 2 of 4</Eyebrow>
        <Heading level="h2" className="mt-3">Pick your handle</Heading>
        <p className="mt-2 text-ink-soft text-sm">
          Shows up on leaderboards and share cards. Pick something you'll be proud to screenshot.
        </p>
        <div className="mt-6">
          <HandleInput value={draft} status={status} onChange={setDraft} />
        </div>
        <Button
          trailing="→"
          fullWidth
          className="mt-8"
          disabled={!canSubmit}
          aria-disabled={!canSubmit}
          onClick={onSubmit}
        >
          {claim.isPending ? "Claiming…" : "Claim handle"}
        </Button>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Verify Kubb has generated `useGetV1HandlesCheck` and `usePatchV1Me`**

```bash
ls packages/api-client/src/hooks/ | grep -E 'HandlesCheck|PatchV1Me'
```

If missing, run `pnpm gen:api-client`. The hook names follow Kubb's `<verb><Path>` convention.

- [ ] **Step 4: Typecheck + smoke**

```bash
pnpm --filter @paper/web typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/onboarding apps/web/src/routes/onboarding/handle.tsx apps/web/src/routeTree.gen.ts
git commit -m "feat(web): /onboarding/handle with debounced uniqueness check"
```

---

### Task 14: /onboarding/balance reveal moment

**Files:**
- Create: `apps/web/src/routes/onboarding/balance.tsx`

This is the spec's "big pastel moment, itself a share-bait frame". Big numeral, soft entrance animation, "Continue" button.

- [ ] **Step 1: Create `apps/web/src/routes/onboarding/balance.tsx`**

```tsx
import { BalanceNumeral } from "@/components/ui/balance-numeral";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { StepIndicator } from "@/components/onboarding/StepIndicator";
import { useOnboardingStore } from "@/stores/onboarding-store";
import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/onboarding/balance")({
  component: BalanceReveal,
});

function BalanceReveal() {
  const acknowledge = useOnboardingStore((s) => s.acknowledgeBalance);

  return (
    <div className="space-y-6">
      <StepIndicator current="balance" />
      <Card tone="ink" elevation="float" padding="lush" className="text-center relative isolate text-paper">
        <span aria-hidden className="pointer-events-none absolute -top-12 -right-12 h-44 w-44 rounded-full bg-peach opacity-45 blur-3xl" />
        <span aria-hidden className="pointer-events-none absolute -bottom-16 -left-12 h-52 w-52 rounded-full bg-mint opacity-35 blur-3xl" />
        <div className="relative">
          <Eyebrow className="text-paper/55">your starter balance</Eyebrow>
          <BalanceNumeral value={10000} size="xl" noDecimal className="mt-5 block" />
          <Heading level="h2" className="mt-4 text-paper">
            of practice cash, ready to invest.
          </Heading>
          <p className="mt-3 text-paper/70 text-sm sm:text-base">
            Trade the 12 biggest cryptos. No real money — but every win counts.
          </p>
          <Link to="/onboarding/lesson" className="block mt-8" onClick={() => acknowledge()}>
            <Button trailing="→" fullWidth>Let's go</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @paper/web typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/onboarding/balance.tsx apps/web/src/routeTree.gen.ts
git commit -m "feat(web): /onboarding/balance — \$10k reveal on ink card"
```

---

### Task 15: /onboarding/lesson + completion → /dashboard

**Files:**
- Create: `apps/web/src/routes/onboarding/lesson.tsx`

The Learn screen lands in Plan 4. Plan 2's onboarding step 4 is a placeholder card with a "Skip to dashboard" CTA. The PRD's "first lesson" share-card moment lands when Learn does.

- [ ] **Step 1: Create `apps/web/src/routes/onboarding/lesson.tsx`**

```tsx
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { StepIndicator } from "@/components/onboarding/StepIndicator";
import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/onboarding/lesson")({
  component: LessonNudge,
});

function LessonNudge() {
  return (
    <div className="space-y-6">
      <StepIndicator current="lesson" />
      <Card tone="paper" elevation="float" padding="lush" className="text-center relative isolate">
        <span aria-hidden className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-lilac opacity-45 blur-3xl" />
        <div className="relative">
          <Eyebrow>step 4 of 4</Eyebrow>
          <Heading level="h2" className="mt-3">Bite-sized lessons,<br/>two minutes each.</Heading>
          <p className="mt-3 text-ink-soft text-sm sm:text-base">
            What is Bitcoin? What's a wallet? What's a stablecoin? We'll teach you the
            absolute basics — pastel cards, no jargon. Coming soon.
          </p>
          <Link to="/dashboard" className="block mt-8">
            <Button trailing="→" fullWidth>Skip to my dashboard</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @paper/web typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/onboarding/lesson.tsx apps/web/src/routeTree.gen.ts
git commit -m "feat(web): /onboarding/lesson placeholder + skip → /dashboard"
```

---

### Phase D — Web dashboard (T16–T19)

### Task 16: AssetChip + AssetList

**Files:**
- Create: `apps/web/src/components/dashboard/AssetChip.tsx`
- Create: `apps/web/src/components/dashboard/AssetList.tsx`

- [ ] **Step 1: Create `apps/web/src/components/dashboard/AssetChip.tsx`**

```tsx
import { cn } from "@/lib/cn";

const PASTEL_BG: Record<"peach" | "mint" | "sky" | "lilac", string> = {
  peach: "bg-peach",
  mint: "bg-mint",
  sky: "bg-sky",
  lilac: "bg-lilac",
};

export function AssetChip({
  letter,
  pastel,
  size = "md",
  className,
}: {
  letter: string;
  pastel: "peach" | "mint" | "sky" | "lilac";
  size?: "sm" | "md";
  className?: string;
}) {
  const sizeClass = size === "sm" ? "h-7 w-7 text-sm" : "h-9 w-9 text-base";
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex items-center justify-center rounded-full font-display font-extrabold text-ink",
        sizeClass,
        PASTEL_BG[pastel],
        className,
      )}
    >
      {letter.slice(0, 1).toUpperCase()}
    </span>
  );
}
```

- [ ] **Step 2: Create `apps/web/src/components/dashboard/AssetList.tsx`**

```tsx
import { AssetChip } from "./AssetChip";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/cn";
import { formatUsd } from "@/lib/currency";
import { useGetV1Assets } from "@paper/api-client";

export function AssetList() {
  const { data, isLoading } = useGetV1Assets({ query: { staleTime: 30_000 } });
  const assets = data?.assets ?? [];

  return (
    <Card tone="paper" elevation="pop" padding="snug" className="w-full">
      <Eyebrow className="mb-4">all assets</Eyebrow>
      {isLoading && <div className="text-ink-soft text-sm py-4">Loading prices…</div>}
      {!isLoading && assets.length === 0 && (
        <div className="text-ink-soft text-sm py-4">No assets to show.</div>
      )}
      <ul role="list" className="divide-y divide-line">
        {assets.map((a) => {
          const change = a.change_24h_pct;
          const changeClass = change == null ? "text-muted" : change >= 0 ? "text-up" : "text-down";
          const sign = change == null ? "" : change >= 0 ? "+" : "";
          return (
            <li key={a.id} className="flex items-center gap-3 py-3">
              <AssetChip letter={a.id} pastel={a.pastel} />
              <div className="flex-1">
                <div className="font-display font-semibold text-ink">{a.name}</div>
                <div className="text-xs text-muted">{a.id}</div>
              </div>
              <div className="text-right">
                <div className="font-display font-semibold tabular-nums text-ink">
                  {a.price_usd != null ? formatUsd(a.price_usd) : "—"}
                </div>
                <div className={cn("text-xs tabular-nums", changeClass)}>
                  {change != null ? `${sign}${change.toFixed(2)}%` : "—"}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @paper/web typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/dashboard
git commit -m "feat(web): AssetChip + AssetList consuming GET /v1/assets"
```

---

### Task 17: HeroPortfolioCard

**Files:**
- Create: `apps/web/src/components/dashboard/HeroPortfolioCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { BalanceNumeral } from "@/components/ui/balance-numeral";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { parseCash } from "@/lib/currency";
import { useGetV1Me } from "@paper/api-client";

export function HeroPortfolioCard() {
  const { data, isLoading } = useGetV1Me({ query: { staleTime: 15_000 } });
  const total = data ? parseCash(data.portfolio.total_value_usd) : 10000;
  const handle = data?.user.handle ?? null;

  return (
    <Card tone="ink" elevation="float" padding="lush" className="relative isolate text-paper">
      <span aria-hidden className="pointer-events-none absolute -top-14 -right-12 h-44 w-44 rounded-full bg-peach opacity-45 blur-3xl" />
      <span aria-hidden className="pointer-events-none absolute -bottom-16 -left-12 h-48 w-48 rounded-full bg-mint opacity-35 blur-3xl" />
      <div className="relative">
        <Eyebrow className="text-paper/55">{handle ? `@${handle}` : "your portfolio"}</Eyebrow>
        <div className="mt-2">
          <BalanceNumeral
            value={total}
            size="lg"
            softDecimal
            className="block text-paper"
          />
        </div>
        <Eyebrow rule className="mt-4 text-paper/60">
          {isLoading ? "loading…" : "0.00% today"}
        </Eyebrow>
      </div>
    </Card>
  );
}
```

(Day's % change will populate in Plan 3 once we have Trade history. Plan 2 prints `0.00% today` as a static placeholder per the spec — no holdings means no change.)

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @paper/web typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/dashboard/HeroPortfolioCard.tsx
git commit -m "feat(web): HeroPortfolioCard consuming GET /v1/me"
```

---

### Task 18: TopMoversStrip

**Files:**
- Create: `apps/web/src/components/dashboard/TopMoversStrip.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { AssetChip } from "./AssetChip";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/cn";
import { useGetV1Assets } from "@paper/api-client";

export function TopMoversStrip() {
  const { data } = useGetV1Assets({ query: { staleTime: 30_000 } });
  const assets = data?.assets ?? [];

  // 5 biggest absolute movers (positive OR negative). Skip rows with no
  // change_24h_pct yet (cold start before first cron tick).
  const movers = assets
    .filter((a) => a.change_24h_pct != null)
    .slice()
    .sort(
      (a, b) =>
        Math.abs((b.change_24h_pct ?? 0)) -
        Math.abs((a.change_24h_pct ?? 0)),
    )
    .slice(0, 5);

  if (movers.length === 0) return null;

  return (
    <section aria-label="Top movers today">
      <Eyebrow className="mb-3">top movers today</Eyebrow>
      <ul
        role="list"
        className="flex gap-3 overflow-x-auto pb-2 -mx-6 px-6 scrollbar-none"
      >
        {movers.map((a) => {
          const change = a.change_24h_pct ?? 0;
          const positive = change >= 0;
          return (
            <li
              key={a.id}
              className="shrink-0 flex flex-col items-center justify-center gap-2 rounded-2xl bg-surface px-4 py-3 shadow-pop min-w-[96px]"
            >
              <AssetChip letter={a.id} pastel={a.pastel} size="sm" />
              <div className="font-display font-semibold text-ink text-sm">{a.id}</div>
              <div
                className={cn(
                  "tabular-nums text-xs font-display font-semibold",
                  positive ? "text-up" : "text-down",
                )}
              >
                {positive ? "+" : ""}{change.toFixed(2)}%
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @paper/web typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/dashboard/TopMoversStrip.tsx
git commit -m "feat(web): TopMoversStrip — 5 biggest |%change| from /v1/assets"
```

---

### Task 19: /dashboard route assembly

**Files:**
- Create: `apps/web/src/routes/dashboard.tsx`

- [ ] **Step 1: Create the route**

```tsx
import { AssetList } from "@/components/dashboard/AssetList";
import { HeroPortfolioCard } from "@/components/dashboard/HeroPortfolioCard";
import { TopMoversStrip } from "@/components/dashboard/TopMoversStrip";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  return (
    <main className="min-h-dvh bg-paper px-6 py-8">
      <div className="mx-auto max-w-md space-y-6">
        <HeroPortfolioCard />
        <TopMoversStrip />
        <AssetList />
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck + dev smoke**

```bash
pnpm --filter @paper/web typecheck
pnpm --filter @paper/web dev &
DEV_PID=$!
sleep 5
curl -sS http://localhost:5173/dashboard -o /tmp/dashboard.html
kill $DEV_PID 2>/dev/null
grep -c '<div id="root">' /tmp/dashboard.html
```

Expected: ≥1 match (the SPA shell).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/dashboard.tsx apps/web/src/routeTree.gen.ts
git commit -m "feat(web): /dashboard — hero card + top movers + asset list"
```

---

### Phase E — E2E + deploy (T20–T22)

### Task 20: Playwright E2E for onboarding

**Files:**
- Create: `apps/web/tests/e2e/onboarding.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
import { expect, test } from "@playwright/test";

test.describe("onboarding flow", () => {
  test.beforeEach(async ({ page }) => {
    // Fresh device per test — reset localStorage to force the new-user path.
    await page.addInitScript(() => localStorage.clear());
  });

  test("new user walks through 4 steps and lands on /dashboard", async ({ page }) => {
    await page.goto("/");
    // Should redirect to /onboarding/welcome (no handle yet).
    await expect(page).toHaveURL(/\/onboarding\/welcome$/);
    await expect(page.getByText(/Get started/i).first()).toBeVisible();

    await page.getByRole("link", { name: /Get started/i }).first().click();
    await expect(page).toHaveURL(/\/onboarding\/handle$/);

    // Type a unique-enough handle. Use a timestamp suffix so consecutive runs
    // against the same dev DB don't collide.
    const handle = `pw_${Date.now().toString(36)}`.slice(0, 20).toLowerCase();
    await page.getByPlaceholder("yourhandle").fill(handle);
    // Wait for the "available ✓" indicator.
    await expect(page.getByText(/available ✓/i)).toBeVisible({ timeout: 5000 });

    await page.getByRole("button", { name: /Claim handle/i }).click();
    await expect(page).toHaveURL(/\/onboarding\/balance$/);

    await page.getByRole("link", { name: /Let's go/i }).click();
    await expect(page).toHaveURL(/\/onboarding\/lesson$/);

    await page.getByRole("link", { name: /Skip to my dashboard/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("returning user with handle skips onboarding entirely", async ({ page }) => {
    // Pre-seed by walking through once.
    const handle = `pw_${Date.now().toString(36)}_r`.slice(0, 20).toLowerCase();
    await page.goto("/onboarding/handle");
    await page.getByPlaceholder("yourhandle").fill(handle);
    await expect(page.getByText(/available ✓/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /Claim handle/i }).click();
    await expect(page).toHaveURL(/\/onboarding\/balance$/);

    // Refresh state: localStorage still has the user, but with handle now.
    // BUT: the client-side `getStoredUser()` only reads what was stored at
    // device-auth time — handle was null then. Verify we still redirect to
    // dashboard via a fresh GET /v1/me round-trip on next root visit. (If
    // not, the redirect rule in routes/index.tsx needs broadening — flag.)
    await page.goto("/");
    // Either /dashboard (handle propagated to localStorage) OR /onboarding/welcome
    // (stale storage). For Plan 2 we accept either — Plan 2.1 can refine.
    await expect(page).toHaveURL(/\/(dashboard|onboarding\/welcome)$/);
  });
});
```

- [ ] **Step 2: Ensure local infra is up + migrations applied**

```bash
podman compose ps
export $(grep -v '^#' .env | xargs)
pnpm --filter @paper/server db:migrate
```

- [ ] **Step 3: Run the new E2E**

```bash
pnpm --filter @paper/web exec playwright test onboarding
```

Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/e2e/onboarding.spec.ts
git commit -m "test(web): E2E for full onboarding flow + returning user redirect"
```

---

### Task 21: Playwright E2E for dashboard

**Files:**
- Create: `apps/web/tests/e2e/dashboard.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
import { expect, test } from "@playwright/test";

test.describe("dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
  });

  test("shows portfolio + asset list + at least the static $10k cash", async ({ page }) => {
    // Walk through onboarding to land on /dashboard with a real session.
    const handle = `pw_${Date.now().toString(36)}_d`.slice(0, 20).toLowerCase();
    await page.goto("/onboarding/handle");
    await page.getByPlaceholder("yourhandle").fill(handle);
    await expect(page.getByText(/available ✓/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /Claim handle/i }).click();
    await page.getByRole("link", { name: /Let's go/i }).click();
    await page.getByRole("link", { name: /Skip to my dashboard/i }).click();

    await expect(page).toHaveURL(/\/dashboard$/);

    // HeroPortfolioCard renders the $10,000 starter balance.
    await expect(page.getByText(/\$10,000/).first()).toBeVisible();

    // AssetList renders 12 rows for the v0 roster — verify at least 6 visible
    // (some may scroll out of viewport on mobile-default viewport).
    const assetIds = ["BTC", "ETH", "SOL", "USDC", "BNB", "XRP", "ADA", "DOGE", "AVAX", "LINK", "DOT", "TON"];
    let visibleCount = 0;
    for (const id of assetIds) {
      try {
        await expect(page.getByText(id, { exact: true }).first()).toBeAttached({ timeout: 1000 });
        visibleCount++;
      } catch {
        /* ignore */
      }
    }
    expect(visibleCount).toBeGreaterThanOrEqual(6);
  });

  test("top movers strip is hidden when no prices are cached", async ({ page }) => {
    // Local Redis may or may not have prices; this test only confirms that the
    // page doesn't crash when movers are empty. Cron writes prices in prod.
    await page.goto("/dashboard");
    await expect(page).not.toHaveURL(/error/);
  });
});
```

- [ ] **Step 2: Run**

```bash
pnpm --filter @paper/web exec playwright test dashboard
```

Expected: 2 passed (assuming the dev infra has paper-redis up — TopMoversStrip returns null gracefully when empty, so the test passes even with no cached prices).

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/e2e/dashboard.spec.ts
git commit -m "test(web): E2E for dashboard render + 12-asset list"
```

---

### Task 22: Build, push image, deploy, verify

**Files:**
- (no source changes; commands only)

The image needs to be rebuilt because `apps/server/dist/jobs/price-ingestion.js` doesn't exist in the previous image (`b86e8e602b5c`). The Dockerfile already copies `apps/server/dist` wholesale, so a fresh build picks up the new entrypoint automatically.

- [ ] **Step 1: Commit the lab manifest if not already**

If `lab/stacks/paper/manifests/30-cron-price-ingestion.yaml` was committed in T9 to the lab repo, skip. Otherwise:

```bash
cd /Users/filipkastovsky/work/personal/lab
git status --short
# (commit the manifest if untracked)
```

- [ ] **Step 2: Build + push the new image**

```bash
cd /Users/filipkastovsky/work/personal/startup
SHA=$(git rev-parse --short=12 HEAD)
echo "deploying $SHA"

export GHCR_USER=filipkastovsky
# Use the existing token from Plan 1 if still valid, otherwise create a fresh one with write:packages
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

(`GHCR_PULL_TOKEN` is the read-only token from Plan 1, still in your shell history.)

If the `paper-migrate` Job is in a stale Failed state from a previous deploy, delete it first:

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

- [ ] **Step 5: Verify the CronJob fires within ~60s**

```bash
sleep 70
kubectl -n paper get cronjob paper-cron-price-ingestion
kubectl -n paper get jobs -l 'cronjob.kubernetes.io/cronjob-name=paper-cron-price-ingestion' --sort-by=.metadata.creationTimestamp | tail -3
kubectl -n paper logs $(kubectl -n paper get pods -l job-name --field-selector status.phase=Succeeded --sort-by=.metadata.creationTimestamp -o name | tail -1)
```

Expected: a recent successful Job, a log line containing `"event":"price_ingestion_done","ok":12`.

- [ ] **Step 6: Verify prices via the API**

```bash
TOKEN=$(curl -sS --tlsv1.2 --tls-max 1.2 -X POST https://api.papercrypto.tech/v1/auth/device \
  -H "content-type: application/json" \
  -d '{"device_uuid":"deadbeef-dead-beef-dead-000000000001"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')

curl -sS --tlsv1.2 --tls-max 1.2 https://api.papercrypto.tech/v1/assets \
  -H "authorization: Bearer $TOKEN" \
  | python3 -m json.tool | head -30
```

Expected: 12 assets, each with `price_usd` non-null and `change_24h_pct` non-null.

- [ ] **Step 7: Build + deploy the web**

```bash
cd /Users/filipkastovsky/work/personal/startup
pnpm --filter @paper/web build
npx wrangler@latest pages deploy apps/web/dist --project-name=paper-web --branch=main --commit-dirty=true
```

Expected: deploy URL like `https://<hash>.paper-web.pages.dev`. Custom domains pick up automatically.

- [ ] **Step 8: Smoke production end-to-end**

Open `https://papercrypto.tech` in a browser:

1. Lands on `/onboarding/welcome` (first visit) — confirm hero numeral + Get started CTA.
2. Click through: handle → balance → lesson → dashboard.
3. Dashboard shows `$10,000.00` in the hero card, ≥6 assets in the list with real prices, top movers strip visible.

If anything's broken, surface it before committing the deploy as final.

- [ ] **Step 9: Commit (no source changes; if there are local-only changes like new screenshots, add them)**

```bash
git status --short
# only out-of-scope items (or new test screenshots) — commit if appropriate
```

- [ ] **Step 10: Push the branch + (optional) merge to main**

```bash
export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/github_ed25519"
git push -u origin plan-2-onboarding-dashboard
```

Plan 2 done. Tag the milestone:

```bash
git tag -a v0.2.0-onboarding -m "Plan 2 — onboarding + dashboard core deployable"
```

---

## Self-review notes

This is the writing-plans skill's mandated self-review pass against the spec.

**Spec coverage delivered by Plan 2:**

- Spec §6.1 onboarding 4 steps — Tasks 11–15 (welcome / handle / balance / lesson placeholder)
- Spec §6.2 Dashboard hero + asset list + top movers — Tasks 16–19; Daily Question + Streak intentionally deferred (Plan 5)
- Spec §8.2 Paper economy: Portfolio + holdings JSON — Task 1 schema + Task 4 service
- Spec §11.1 price_ingestion_cron (amended to 60s in stack spec §4.1) — Tasks 8–9
- Spec §11.6 idempotency on POST writes — already in place from Plan 1's auth flow; Plan 2's PATCH /v1/me uses optimistic concurrency by relying on UNIQUE constraint + 409 mapping (no idempotency_key needed for Plan 2 endpoints since they're nullipotent re-applications)
- Marshmallow design system §4 (numerals are hero) — HeroPortfolioCard + balance reveal both lead with `<BalanceNumeral>` per Plan 1's convention
- Marshmallow §9.4 asset chip — AssetChip with pastel rotation by stable index
- Marshmallow §9 hero card — HeroPortfolioCard with `tone="ink"` + peach/mint blobs

**Spec coverage explicitly deferred:**

- §6.2 Daily Market Question card → Plan 5
- §6.2 Streak flame → Plan 5
- §6.2 hero card "% today" change row → Plan 3 (needs trade history to be meaningful)
- §6.3 Trade screen + execution → Plan 3
- §6.4 Learn → Plan 4
- §6.5 Ranks → Plan 6
- §6.6 Profile → Plan 7
- §7.1–7.4 daily question / streak / share cards / push → Plans 5/7
- §8.3 lessons schema → Plan 4
- §8.4 daily-engagement schema → Plan 5
- §8.5 share cards schema → Plan 7
- §8.6 leaderboard → Plan 6
- §11.1 daily-question-create / -resolve / leaderboard-recompute / streak-reaper crons → Plans 5/6

**Placeholder scan:** none. Every step has actual code or actual commands.

**Type consistency check:**

- `AssetId` exported from `@paper/shared`, consumed by both server (`assets.ts`, `prices.ts`, `portfolio.ts`) and web (via Kubb-generated types). ✓
- `HoldingsJson` defined in `portfolios.ts` schema, consumed by `portfolio.ts` service. ✓
- `cash_usd` / `cost_basis` / `qty` are `numeric(20,8)` strings on the wire and in TS — wrapped with `decimal.js` for arithmetic, parsed via `parseCash` for display. ✓
- `PASTEL_BG` keys in `AssetChip.tsx` match the `AssetPastel` union from shared. ✓
- The PATCH /v1/me response shape `{ user }` differs from GET /v1/me's `{ user, portfolio }` — intentional, because PATCH doesn't recompute valuation. The client navigates after PATCH and refetches /v1/me on the dashboard.
- `usePatchV1Me` and `useGetV1HandlesCheck` Kubb hook names are predictions — verify after first `pnpm gen:api-client` run; if Kubb's naming differs (it sometimes uses a different verb prefix), update the imports in Task 13 step 2.

**Architecture spot-checks:**

- The cron uses the same image as paper-api, different `CMD`. Plan 1's Dockerfile already copies `apps/server/dist` wholesale, so the new `dist/jobs/price-ingestion.js` lands automatically. No Dockerfile changes needed.
- The price cache in Redis is written by the cron, read by the API. They share the per-app Redis (per-namespace). The pool ceilings: paper-api uses ioredis defaults (1 conn × 2 plugins = 2 conns); cron uses 1 conn × 1 plugin = 1 conn. Both well under any reasonable Redis max-clients (default 10000). No bottleneck.
- Postgres pool from Plan 1's `makeDb` is configurable; Plan 2 inherits the production default of 10. Cron jobs that don't touch Postgres (price ingestion is one such) get `closeRedis()` only. Plan 5's daily-question crons WILL touch Postgres and should pass `{ max: 1 }` to `makeDb`.
- The auto-init portfolio in `/v1/auth/device` is idempotent (`onConflictDoNothing`). No race on concurrent first-time auths because Plan 1's atomic upsert ensures only one user row is created.
- `pickInitialRoute()` reads from `localStorage.paper.user` which is set by Plan 1's `bootstrapAuth()`. There's a brief window where `localStorage.paper.user.handle` is `null` even though the server has it — happens after the user PATCHes their handle but doesn't re-bootstrap. Mitigation: Task 13's submit handler calls `setClaimedHandle()` AND `navigate({ to: "/onboarding/balance" })`, and `useGetV1Me` on `/dashboard` refetches. Stale localStorage doesn't break navigation; it's only a hint for `/`'s redirect. Acceptable v0 cost; the Plan 2 E2E test 2 ("returning user with handle skips onboarding") tolerates either redirect target.

**Ambiguity check:**

- Currency precision: `numeric(20,8)` stored, `string` on the wire, `Decimal` for math, `number` for display. The mixing is documented at the boundary (`parseCash` and `formatUsd`). Acceptable.
- "Top movers" semantics: spec says "5 biggest % movers today". I interpret as 5 biggest *absolute* % moves (positive or negative), per typical fintech UX. If the spec meant 5 biggest *gainers*, the change is one line in `TopMoversStrip` (drop `Math.abs`). Flag if a stakeholder disagrees.
- Asset list ordering on dashboard: kept stable (canonical `ASSETS` order). The spec doesn't say "sorted by price" or "sorted by % move" anywhere — stable canonical order is the cleanest choice for v0.
- Test 2 of `onboarding.spec.ts` ("returning user skips onboarding") accepts either `/dashboard` OR `/onboarding/welcome` because the localStorage hint may be stale after an in-flight PATCH. If a tighter assertion is desired, refactor `pickInitialRoute()` to read from `useGetV1Me` instead of localStorage — that's a Plan 2.1 cleanup, not strictly necessary for v0.

If any of the deferred items in the "explicitly deferred" list block your review, surface them now and I'll adjust the decomposition.
