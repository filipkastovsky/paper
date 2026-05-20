# Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Web Push Notifications for the paper crypto PWA. Users can opt in from the dashboard to receive browser push notifications at 09:00 UTC (daily question live) and 20:00 UTC (streak-at-risk reminder). The server stores VAPID-keyed push subscriptions per user, an in-process hourly scheduler fires the two notification types, and the web service worker is migrated from `generateSW` to `injectManifest` to enable a custom push event handler.

**Architecture:**
- `push_subscriptions` table: one row per browser subscription endpoint, FK'd to `users`. A user may have multiple subscriptions (multi-device).
- Three push routes behind `/v1/push/`: `GET /v1/push/vapid-key` (public), `POST /v1/push/subscribe` (auth), `POST /v1/push/unsubscribe` (auth).
- `services/push.ts`: thin wrapper around `web-push`, plus `subscribeUser` / `unsubscribeUser` / `sendToUser` helpers.
- In-process `setInterval` in `buildServer` (production only, hourly) dispatches `daily_question_live` at hour 9 UTC and `streak_at_risk` at hour 20 UTC.
- Web: VitePWA switches from `generateSW` to `injectManifest`; `src/sw.ts` contains push + notificationclick handlers alongside all existing workbox caching logic.
- Web: `PushOptIn` component on the dashboard that requests browser permission, fetches the VAPID public key, creates a `PushSubscription`, and POSTs it to the server.

**Tech Stack:**
- Server: Fastify 5, Zod 4, Drizzle ORM, postgres.js, `@fastify/jwt`, `web-push`
- Web: Vite + VitePWA (`injectManifest`), React 18, TanStack Query (generated hooks), Zustand, Tailwind v4, Marshmallow design tokens
- Tests: Vitest (pool: `forks`, `singleFork: true`), `vi.mock` for `web-push`
- Container: podman arm64, K8s secret for VAPID keys

**Branch:** `plan-8-push-notifications` off `plan-7-leaderboard`

---

**Prerequisites:**
- P1: Working on branch `plan-8-push-notifications` branched off `plan-7-leaderboard`
- P2: `podman compose up` — Postgres + Redis containers running
- P3: `pnpm install` up to date across the monorepo
- P4: Plans 1–7 shipped; `streaks`, `daily_questions`, `leaderboard_snapshots` tables exist

---

## File Structure

```
apps/server/
  src/db/schema/push-subscriptions.ts        # T2 — new table
  src/db/schema/index.ts                     # T2 — re-export
  drizzle/0008_*.sql                         # T2 — generated migration (next after 0007)
  test/helpers/db.ts                         # T2 — add push_subscriptions to truncate list
  src/services/push.ts                       # T3 — push service + web-push wrapper
  test/services/push.test.ts                 # T3 — service unit tests (mocked web-push)
  src/routes/push.ts                         # T4 — 3 push routes
  src/server.ts                              # T4 — register push routes, initWebPush, scheduler
  src/config.ts                              # T1 — VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY fields
  test/helpers/server.ts                     # T1 — add dummy VAPID keys to test config
  test/routes/push.test.ts                   # T4 — route integration tests

packages/api-client/                        # T6 — Kubb codegen re-run

apps/web/
  vite.config.ts                             # T7 — switch to injectManifest strategy
  src/sw.ts                                  # T7 — new service worker with push handler
  src/lib/push.ts                            # T7 — browser-side push subscribe/unsubscribe helpers
  src/components/dashboard/PushOptIn.tsx     # T7 — opt-in button component
  src/routes/dashboard.tsx                   # T7 — wire PushOptIn into dashboard

lab repo (/Users/filipkastovsky/work/personal/lab):
  stacks/paper/manifests/20-paper-api-deployment.yaml  # T8 — add VAPID env vars
```

---

## Task 1: Install dependencies, generate VAPID keys, update config + test helpers

**Files:**
- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/test/helpers/server.ts`

### Step 1.1 — Install server dependency

```bash
pnpm --filter @paper/server add web-push
pnpm --filter @paper/server add -D @types/web-push
```

### Step 1.2 — Install web workbox dev dependencies

```bash
pnpm --filter @paper/web add -D workbox-precaching workbox-routing workbox-strategies workbox-expiration
```

### Step 1.3 — Generate VAPID keys (one-time; do NOT commit the private key to source control)

```bash
# Run on developer machine — output goes to stdout only
npx web-push generate-vapid-keys
```

The command outputs two lines:
```
Public Key:
BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U

Private Key:
UUxI4O8-HoSvQnHBrfWEPljd0-m7QkGCHJaFqHQBTMs
```

> **Security note:** The keys shown above are example/dummy values only — they must NOT be used in production. Regenerate fresh keys with the command above and store the result in K8s (see T8). Never put the private key in source control or Docker images.

Store real keys in K8s:
```bash
kubectl patch secret paper-app -n paper --type=merge \
  -p '{"stringData":{"VAPID_PUBLIC_KEY":"<generated-public-key>","VAPID_PRIVATE_KEY":"<generated-private-key>"}}'
```

### Step 1.4 — Update `apps/server/src/config.ts`

Add two fields to `ConfigSchema` after `REDIS_URL`:

```typescript
// apps/server/src/config.ts — full file after edit:
import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),
  VAPID_PUBLIC_KEY: z.string().min(1),
  VAPID_PRIVATE_KEY: z.string().min(1),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default("paper-api"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration");
  }
  return parsed.data;
}
```

- [ ] Apply the `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` additions to `ConfigSchema`.

### Step 1.5 — Update `apps/server/test/helpers/server.ts`

Add dummy VAPID keys to the `loadConfig` call. These example values are safe to use in CI/test because `initWebPush` is never called in test environments (the scheduler is gated on `NODE_ENV === "production"` and `web-push` is mocked in service tests):

```typescript
// apps/server/test/helpers/server.ts — full file after edit:
import { loadConfig } from "@/config.js";
import { type DbHandles, makeDb } from "@/db/client.js";
import { buildServer } from "@/server.js";

export interface TestServer {
  app: Awaited<ReturnType<typeof buildServer>>;
  db: DbHandles["db"];
  sql: DbHandles["sql"];
  config: ReturnType<typeof loadConfig>;
}

export async function makeTestServer(): Promise<TestServer> {
  const config = loadConfig({
    ...process.env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/paper",
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
    JWT_SECRET: "test-secret-must-be-at-least-32-characters-long",
    // Dummy VAPID keys — example values, safe for tests only, NOT for production
    VAPID_PUBLIC_KEY:
      "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
    VAPID_PRIVATE_KEY: "UUxI4O8-HoSvQnHBrfWEPljd0-m7QkGCHJaFqHQBTMs",
    LOG_LEVEL: "fatal",
  });
  const handles = makeDb(config.DATABASE_URL, { max: 2 });
  const app = await buildServer({ config, db: handles.db });
  await app.ready();
  return { app, db: handles.db, sql: handles.sql, config };
}
```

- [ ] Apply the VAPID key additions to `makeTestServer`.

---

## Task 2: `push_subscriptions` DB schema + migration + truncateAllTables

**Files:**
- Create: `apps/server/src/db/schema/push-subscriptions.ts`
- Modify: `apps/server/src/db/schema/index.ts`
- Modify: `apps/server/test/helpers/db.ts`
- Generate: `apps/server/drizzle/0008_*.sql` (via `db:generate`)

### Step 2.1 — Create `apps/server/src/db/schema/push-subscriptions.ts`

```typescript
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * Browser push subscription record.
 *
 * One user may have N subscriptions (one per browser/device).
 * The `endpoint` is globally unique — if a user re-subscribes from the same
 * browser the row is upserted in place (endpoint is the natural key).
 *
 * Cascade delete on user removal ensures no orphaned subscriptions.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("push_subscriptions_user_id_idx").on(t.userId),
  }),
);

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
```

- [ ] Create `apps/server/src/db/schema/push-subscriptions.ts` with the content above.

### Step 2.2 — Re-export from `apps/server/src/db/schema/index.ts`

The current `index.ts` ends with `lesson-progress`. Append the new export:

```typescript
export * from "./users.js";
export * from "./refresh-tokens.js";
export * from "./portfolios.js";
export * from "./trades.js";
export * from "./portfolio-snapshots.js";
export * from "./lesson-progress.js";
// Plans 5–7 added: streaks, user-predictions, prediction-points, daily-questions, leaderboard-snapshots
export * from "./streaks.js";
export * from "./user-predictions.js";
export * from "./prediction-points.js";
export * from "./daily-questions.js";
export * from "./leaderboard-snapshots.js";
// Plan 8:
export * from "./push-subscriptions.js";
```

> Note: Add only the `export * from "./push-subscriptions.js";` line — the exports for plans 5–7 will already be present after those plans ran. The list above shows the full expected state for reference.

- [ ] Append `export * from "./push-subscriptions.js";` to `apps/server/src/db/schema/index.ts`.

### Step 2.3 — Generate the migration

```bash
cd apps/server && pnpm db:generate
```

This produces `drizzle/0008_<random-name>.sql`. Verify it contains:
- `CREATE TABLE "push_subscriptions"` with all six columns
- `CREATE UNIQUE INDEX` on `endpoint`
- `CREATE INDEX push_subscriptions_user_id_idx`
- `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade`

- [ ] Run `pnpm db:generate` and commit the generated SQL file.

### Step 2.4 — Apply migration locally

```bash
cd apps/server && pnpm db:migrate
```

- [ ] Run `pnpm db:migrate` to apply migration to local dev DB.

### Step 2.5 — Update `apps/server/test/helpers/db.ts`

The full table list after Plan 8:

```typescript
import type { Db } from "@/db/client.js";
import { sql } from "drizzle-orm";

export async function truncateAllTables(db: Db): Promise<void> {
  // Order matters via FK chain; CASCADE handles deps regardless of order.
  // Spell out every table so CI fails fast when a new table forgets to add itself.
  await db.execute(
    sql`TRUNCATE TABLE "trades", "portfolio_snapshots", "portfolios", "refresh_tokens", "lesson_progress", "streaks", "user_predictions", "prediction_points", "daily_questions", "leaderboard_snapshots", "push_subscriptions", "users" RESTART IDENTITY CASCADE`,
  );
}
```

- [ ] Add `"push_subscriptions"` to the TRUNCATE list in `apps/server/test/helpers/db.ts`.

---

## Task 3: Push service (`services/push.ts`) + unit tests

**Files:**
- Create: `apps/server/src/services/push.ts`
- Create: `apps/server/test/services/push.test.ts`

### Step 3.1 — Create `apps/server/src/services/push.ts`

```typescript
import { eq } from "drizzle-orm";
import webPush from "web-push";
// NOTE: web-push ships as CommonJS. Under NodeNext ESM, Node's CJS interop
// surfaces the module's `exports` object as `webPush` (the default import),
// which has `setVapidDetails`, `sendNotification`, etc. as direct properties.
import type { Db } from "@/db/client.js";
import { pushSubscriptions } from "@/db/schema/index.js";

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url?: string;
}

/**
 * Call once during server startup with the VAPID credentials from config.
 * Idempotent: subsequent calls simply overwrite the module-level state inside
 * web-push (which is fine; the same values are always passed).
 */
export function initWebPush(config: {
  vapidPublicKey: string;
  vapidPrivateKey: string;
}): void {
  webPush.setVapidDetails(
    "mailto:ops@papercrypto.tech",
    config.vapidPublicKey,
    config.vapidPrivateKey,
  );
}

/**
 * Send a single push notification to a specific subscription endpoint.
 *
 * Returns `"ok"` on success or `"gone"` when the push service returns HTTP 410
 * (subscription revoked/expired). The caller is responsible for deleting the
 * stale row when `"gone"` is returned.
 *
 * All other errors are re-thrown (network errors, 5xx from push server, etc.).
 */
export async function sendPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
): Promise<"ok" | "gone"> {
  try {
    await webPush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
    );
    return "ok";
  } catch (err) {
    // HTTP 410 Gone = the subscription has been revoked or has expired.
    // Treat it as a signal to remove the row, not as an unexpected error.
    if (
      err !== null &&
      typeof err === "object" &&
      "statusCode" in err &&
      (err as { statusCode: number }).statusCode === 410
    ) {
      return "gone";
    }
    throw err;
  }
}

/**
 * Send a push notification to all subscriptions belonging to a user.
 * Stale (410 Gone) subscriptions are deleted in the same pass.
 *
 * Returns the number of notifications successfully delivered.
 */
export async function sendToUser(
  db: Db,
  userId: string,
  payload: PushPayload,
): Promise<number> {
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

  let sent = 0;
  for (const sub of subs) {
    const result = await sendPush(sub, payload);
    if (result === "gone") {
      await db
        .delete(pushSubscriptions)
        .where(eq(pushSubscriptions.id, sub.id));
    } else {
      sent++;
    }
  }
  return sent;
}

/**
 * Upsert a push subscription for a user.
 *
 * Uses `onConflictDoUpdate` on `endpoint` so that if the same browser
 * re-subscribes (e.g. after a VAPID key rotation or browser reinstall) the
 * existing row is updated rather than erroring on the unique constraint.
 */
export async function subscribeUser(
  db: Db,
  userId: string,
  sub: { endpoint: string; p256dh: string; auth: string },
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: sub.p256dh,
        auth: sub.auth,
      },
    });
}

/**
 * Delete a push subscription by endpoint.
 * Called when the user explicitly unsubscribes from the browser.
 * No-op if the endpoint doesn't exist.
 */
export async function unsubscribeUser(db: Db, endpoint: string): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint));
}
```

- [ ] Create `apps/server/src/services/push.ts`.

### Step 3.2 — Create `apps/server/test/services/push.test.ts`

```typescript
import { pushSubscriptions, users } from "@/db/schema/index.js";
import {
  sendPush,
  sendToUser,
  subscribeUser,
  unsubscribeUser,
} from "@/services/push.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { truncateAllTables } from "../helpers/db.js";
import { type TestServer, makeTestServer } from "../helpers/server.js";

// Mock web-push at the module level so no network calls are made.
// The mock is hoisted to the top of the module by Vitest.
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue({}),
  },
}));

// Helper to import the mocked module after the mock is registered.
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
    // Should not throw
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

    await expect(
      sendPush(TEST_SUB, { title: "Test", body: "Hello", tag: "test" }),
    ).rejects.toThrow("Internal Server Error");
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
    const sub2 = { ...TEST_SUB, endpoint: TEST_SUB.endpoint + "-2" };
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
    wp.sendNotification
      .mockRejectedValueOnce(gone)  // first sub → gone
      .mockResolvedValueOnce({});   // second sub → ok

    const userId = await seedUser("ffffffff-ffff-ffff-ffff-ffffffffffff");
    const stale = { ...TEST_SUB, endpoint: TEST_SUB.endpoint + "-stale" };
    const good = { ...TEST_SUB, endpoint: TEST_SUB.endpoint + "-good" };
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
```

- [ ] Create `apps/server/test/services/push.test.ts`.

### Step 3.3 — Run service tests

```bash
cd apps/server && pnpm test -- --reporter=verbose test/services/push.test.ts
```

All tests must pass before proceeding.

- [ ] Verify all push service tests pass.

---

## Task 4: Push routes + register in server.ts + integration tests

**Files:**
- Create: `apps/server/src/routes/push.ts`
- Modify: `apps/server/src/server.ts`
- Create: `apps/server/test/routes/push.test.ts`

### Step 4.1 — Create `apps/server/src/routes/push.ts`

```typescript
import { subscribeUser, unsubscribeUser } from "@/services/push.js";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const VapidKeyResponse = z.object({
  vapid_public_key: z.string(),
});

const SubscribeBody = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});

const UnsubscribeBody = z.object({
  endpoint: z.string().url(),
});

export const pushRoutes: FastifyPluginAsyncZod = async (app) => {
  /**
   * GET /v1/push/vapid-key
   * Public — no authentication required.
   * Returns the VAPID public key the browser needs to create a PushSubscription.
   */
  app.get(
    "/v1/push/vapid-key",
    {
      schema: {
        tags: ["push"],
        summary: "VAPID public key",
        response: { 200: VapidKeyResponse },
      },
    },
    async () => {
      return { vapid_public_key: app.config.VAPID_PUBLIC_KEY };
    },
  );

  /**
   * POST /v1/push/subscribe
   * Auth required. Upserts a push subscription for the authenticated user.
   */
  app.post(
    "/v1/push/subscribe",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["push"],
        summary: "Subscribe to push notifications",
        security: [{ bearerAuth: [] }],
        body: SubscribeBody,
        response: { 204: z.void() },
      },
    },
    async (request, reply) => {
      const userId = request.user.sub;
      await subscribeUser(app.db, userId, request.body);
      return reply.code(204).send();
    },
  );

  /**
   * POST /v1/push/unsubscribe
   * Auth required. Deletes the push subscription matching the given endpoint.
   * No-op if the endpoint is not found (idempotent).
   */
  app.post(
    "/v1/push/unsubscribe",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["push"],
        summary: "Unsubscribe from push notifications",
        security: [{ bearerAuth: [] }],
        body: UnsubscribeBody,
        response: { 204: z.void() },
      },
    },
    async (request, reply) => {
      await unsubscribeUser(app.db, request.body.endpoint);
      return reply.code(204).send();
    },
  );
};
```

- [ ] Create `apps/server/src/routes/push.ts`.

### Step 4.2 — Update `apps/server/src/server.ts`

Three additions:
1. Import `initWebPush` and push scheduler helpers.
2. Call `initWebPush(config)` before registering routes.
3. Register `pushRoutes`.
4. Add the in-process push scheduler (see Task 5 below — done here since it all touches `server.ts`).

Full updated `apps/server/src/server.ts`:

```typescript
import fastifyCors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyMetricsPkg from "fastify-metrics";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import {
  dailyQuestions,
  pushSubscriptions,
  streaks,
} from "./db/schema/index.js";
import { authPlugin } from "./plugins/auth.js";
import { rateLimitPlugin } from "./plugins/rate-limit.js";
import { registerSwagger } from "./plugins/swagger.js";
import { assetsRoutes } from "./routes/assets.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { learnRoutes } from "./routes/learn.js";
import { meRoutes } from "./routes/me.js";
import { pushRoutes } from "./routes/push.js";
import { tradesRoutes } from "./routes/trades.js";
import { initWebPush, sendPush, sendToUser } from "./services/push.js";

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

  // Initialise VAPID credentials before any push notification is sent.
  initWebPush({
    vapidPublicKey: config.VAPID_PUBLIC_KEY,
    vapidPrivateKey: config.VAPID_PRIVATE_KEY,
  });

  // CORS — local Vite dev in development; the production web origin in production.
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
  await app.register(learnRoutes);
  await app.register(pushRoutes);

  // Push notification scheduler.
  // Only runs in production to avoid accidental push dispatch during tests or
  // local dev. The interval fires every full hour; the handler checks UTC hour
  // and dispatches the appropriate notification type.
  if (config.NODE_ENV === "production") {
    setInterval(async () => {
      const hour = new Date().getUTCHours();
      try {
        if (hour === 9) {
          // 09:00 UTC — daily_question_live
          // Check today's question exists before sending anything.
          const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
          const [question] = await db
            .select()
            .from(dailyQuestions)
            .where(eq(dailyQuestions.date, today));

          if (question) {
            const allSubs = await db.select().from(pushSubscriptions);
            for (const sub of allSubs) {
              await sendPush(sub, {
                title: "Daily Question is live 📊",
                body: `Will ${question.assetId} close up or down today?`,
                tag: "daily_question_live",
                url: "/",
              }).catch(() => {
                // Swallow individual delivery errors — stale sub cleanup
                // happens inside sendToUser; here we fan-out across all subs
                // directly and don't need per-row cleanup because a single
                // failed push doesn't invalidate others.
              });
            }
          }
        }

        if (hour === 20) {
          // 20:00 UTC — streak_at_risk
          // Target: users with current_days > 0 who have NOT acted today.
          const dayStartUtc = new Date();
          dayStartUtc.setUTCHours(0, 0, 0, 0);

          const atRisk = await db
            .select({ userId: streaks.userId })
            .from(streaks)
            .where(
              and(
                gt(streaks.currentDays, 0),
                lt(streaks.lastQualifyingActionAt, dayStartUtc),
              ),
            );

          for (const { userId } of atRisk) {
            await sendToUser(db, userId, {
              title: "Streak at risk 🔥",
              body: "Complete a lesson or trade today to keep your streak alive.",
              tag: "streak_at_risk",
              url: "/",
            }).catch(() => {});
          }
        }
      } catch (err) {
        app.log.warn({ err }, "push scheduler error");
      }
    }, 60 * 60 * 1000); // hourly
  }

  return app;
}

export type AppInstance = FastifyInstance;
```

> **Import note:** `dailyQuestions`, `pushSubscriptions`, `streaks` are available from `"./db/schema/index.js"` after Plans 5–7 and T2 of this plan run. Adjust the import path if those exports end up in plan-specific files rather than re-exported through index.

- [ ] Apply the changes described above to `apps/server/src/server.ts`.

### Step 4.3 — Create `apps/server/test/routes/push.test.ts`

```typescript
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
    // The test config injects a known dummy key
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

    // Subscribe first
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
```

- [ ] Create `apps/server/test/routes/push.test.ts`.

### Step 4.4 — Run route tests

```bash
cd apps/server && pnpm test -- --reporter=verbose test/routes/push.test.ts
```

All tests must pass.

- [ ] Verify all push route tests pass.

### Step 4.5 — Run full test suite

```bash
cd apps/server && pnpm test
```

No regressions.

- [ ] Verify full server test suite passes.

---

## Task 5: In-process push scheduler

The scheduler is already embedded in Task 4's `server.ts` update. This task documents the standalone verification step.

### Step 5.1 — Manual smoke test (local)

Start the server in development mode with VAPID env vars set:

```bash
VAPID_PUBLIC_KEY="<your-public-key>" \
VAPID_PRIVATE_KEY="<your-private-key>" \
pnpm --filter @paper/server dev
```

Confirm no startup error in the pino logs. The scheduler does not fire in development (`NODE_ENV` check), so no push is dispatched.

### Step 5.2 — Verify scheduler skipped in test

Run:
```bash
cd apps/server && pnpm test -- --reporter=verbose
```

Confirm no `setInterval` fires during tests (because `makeTestServer` sets `NODE_ENV: "test"`).

- [ ] Confirm server starts cleanly with VAPID env vars in dev mode.
- [ ] Confirm test suite has no unexpected push-related log output.

---

## Task 6: Kubb codegen

The three new push endpoints change the OpenAPI spec. Codegen must be re-run to generate typed hooks and client functions.

### Step 6.1 — Dump updated OpenAPI spec

```bash
pnpm --filter @paper/server openapi:dump
# Writes to packages/api-client/openapi.json
```

Verify `openapi.json` now contains paths for:
- `GET /v1/push/vapid-key`
- `POST /v1/push/subscribe`
- `POST /v1/push/unsubscribe`

- [ ] Run `openapi:dump` and verify the three push paths are present in `openapi.json`.

### Step 6.2 — Run Kubb codegen

```bash
pnpm --filter @paper/api-client gen
# Equivalent to: pnpm --filter @paper/server openapi:dump && kubb
```

This regenerates `packages/api-client/src/` and produces:
- `src/types/pushSubscribeBody.ts`, `src/types/unsubscribeBody.ts`, `src/types/vapidKeyResponse.ts`
- `src/hooks/useGetV1PushVapidKey.ts`
- `src/hooks/usePostV1PushSubscribe.ts`
- `src/hooks/usePostV1PushUnsubscribe.ts`
- Corresponding `src/client/`, `src/zod/`, `src/msw/` files

- [ ] Run `pnpm --filter @paper/api-client gen` and verify output files are generated.

### Step 6.3 — Typecheck

```bash
pnpm --filter @paper/api-client typecheck
pnpm --filter @paper/web typecheck
```

Both must pass with zero errors.

- [ ] Confirm `@paper/api-client` and `@paper/web` typecheck clean.

---

## Task 7: Web — service worker + push opt-in

**Files:**
- Modify: `apps/web/vite.config.ts`
- Create: `apps/web/src/sw.ts`
- Create: `apps/web/src/lib/push.ts`
- Create: `apps/web/src/components/dashboard/PushOptIn.tsx`
- Modify: `apps/web/src/routes/dashboard.tsx`

### Step 7.1 — Switch VitePWA to `injectManifest` strategy

The current `vite.config.ts` uses the default `generateSW` strategy which auto-generates the service worker. Switching to `injectManifest` lets us write `src/sw.ts` ourselves and add push event handlers while keeping Workbox for precaching and runtime caching.

Key differences from the existing config:
- Add `strategies: "injectManifest"`, `srcDir: "src"`, `filename: "sw.ts"` at the top level.
- The `workbox` key in `injectManifest` mode only accepts `globPatterns` for precache injection — runtime caching must move into `src/sw.ts` using workbox strategy classes.
- `devOptions: { enabled: true, type: "module" }` stays for development SW support.

Full updated `apps/web/vite.config.ts`:

```typescript
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: "auto",
      devOptions: { enabled: true, type: "module" },
      manifest: {
        name: "paper",
        short_name: "paper",
        description: "Learn crypto with $10,000 of practice cash.",
        theme_color: "#FAFAF1",
        background_color: "#FAFAF1",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      // In injectManifest mode, `workbox` only controls precache injection.
      // Runtime caching is handled in src/sw.ts via workbox strategy classes.
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
    }),
  ],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  server: { port: 5173 },
});
```

- [ ] Update `apps/web/vite.config.ts` with the `injectManifest` configuration above.

### Step 7.2 — Create `apps/web/src/sw.ts`

This file is the custom service worker. It is built by VitePWA during `vite build` and served as `sw.js`. It must:
1. Precache all assets injected by Workbox (`self.__WB_MANIFEST`).
2. Register runtime caching routes that replicate the previous `runtimeCaching` config.
3. Handle `push` events and show notifications.
4. Handle `notificationclick` events to focus/open the app at the notification URL.

```typescript
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare let self: ServiceWorkerGlobalScope & typeof globalThis;

// Precache all assets injected at build time by VitePWA / Workbox.
// `self.__WB_MANIFEST` is replaced by the actual precache manifest at build time.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Runtime caching — API reads: NetworkFirst, 1 hour cache, 5 second network timeout.
// Matches the previous generateSW runtimeCaching config.
registerRoute(
  ({ url }: { url: URL }) =>
    /\/v1\/(auth\/[^/]+|portfolio|me|leaderboard|lessons|push)/.test(url.pathname) &&
    !url.pathname.includes("/auth/device") &&
    !url.pathname.includes("/auth/refresh"),
  new NetworkFirst({
    cacheName: "api-read",
    networkTimeoutSeconds: 5,
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 }),
    ],
  }),
);

// Static assets and fonts: CacheFirst with long TTL.
registerRoute(
  ({ request }: { request: Request }) =>
    request.destination === "image" || request.destination === "font",
  new CacheFirst({
    cacheName: "static-assets",
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  }),
);

// Google Fonts: CacheFirst, 1 year.
registerRoute(
  ({ url }: { url: URL }) => /https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/.test(url.href),
  new CacheFirst({
    cacheName: "google-fonts",
    plugins: [
      new ExpirationPlugin({ maxAgeSeconds: 365 * 24 * 60 * 60 }),
    ],
  }),
);

// Push event handler — receives push messages from the server and shows
// a browser notification with the payload data.
self.addEventListener("push", (event: PushEvent) => {
  if (!event.data) return;

  const data = event.data.json() as {
    title: string;
    body: string;
    tag: string;
    url?: string;
  };

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      // icon must be a precached asset served by the PWA itself.
      icon: "/icons/icon-192.png",
      // badge can be added later when a monochrome badge icon is available.
      data: { url: data.url ?? "/" },
    }),
  );
});

// Notification click handler — closes the notification and focuses or opens
// the app at the URL embedded in the notification data.
self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();

  const url = (event.notification.data as { url: string }).url;

  event.waitUntil(
    // Focus an already-open window/tab on the same origin if possible;
    // otherwise open a new tab to `url`.
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url === url && "focus" in client) {
            return (client as WindowClient).focus();
          }
        }
        return clients.openWindow(url);
      }),
  );
});
```

- [ ] Create `apps/web/src/sw.ts`.

### Step 7.3 — Create `apps/web/src/lib/push.ts`

This module provides browser-side push helpers: converting a `PushSubscription` to the server payload format, requesting permission and subscribing, and unsubscribing.

```typescript
/**
 * Browser-side push notification helpers.
 *
 * Flow:
 *   1. Browser calls `Notification.requestPermission()` — user sees the prompt.
 *   2. We fetch the VAPID public key from GET /v1/push/vapid-key.
 *   3. We call `registration.pushManager.subscribe()` with the key.
 *   4. We POST the resulting PushSubscription to POST /v1/push/subscribe.
 */

/**
 * Convert a VAPID public key from base64url to a Uint8Array.
 * The browser's PushManager requires the `applicationServerKey` as
 * a typed array, not a string.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export interface PushSubscribePayload {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Serialize a browser `PushSubscription` into the shape expected by
 * `POST /v1/push/subscribe`.
 */
function serializeSubscription(sub: PushSubscription): PushSubscribePayload {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("Incomplete PushSubscription — missing endpoint or keys");
  }
  return {
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  };
}

/**
 * Request browser push notification permission, subscribe, and POST the
 * subscription to the server.
 *
 * @param vapidPublicKey - The VAPID public key from GET /v1/push/vapid-key
 * @param apiBase        - Base URL of the API (e.g. "https://api.papercrypto.tech")
 * @param accessToken    - Current JWT access token for the authenticated user
 *
 * @returns The serialized subscription that was sent to the server.
 * @throws  If permission is denied, if the browser doesn't support push,
 *          or if the server POST fails.
 */
export async function requestPushPermission(
  vapidPublicKey: string,
  apiBase: string,
  accessToken: string,
): Promise<PushSubscribePayload> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Push notifications not supported in this browser");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Push notification permission denied");
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  const payload = serializeSubscription(subscription);

  const res = await fetch(`${apiBase}/v1/push/subscribe`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Failed to register push subscription: ${res.status}`);
  }

  return payload;
}

/**
 * Unsubscribe the current browser from push notifications and notify the server.
 *
 * @param apiBase     - Base URL of the API
 * @param accessToken - Current JWT access token
 */
export async function revokePushSubscription(
  apiBase: string,
  accessToken: string,
): Promise<void> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();

  await fetch(`${apiBase}/v1/push/unsubscribe`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ endpoint }),
  });
}
```

- [ ] Create `apps/web/src/lib/push.ts`.

### Step 7.4 — Create `apps/web/src/components/dashboard/PushOptIn.tsx`

The component is conditionally rendered only when:
- The browser supports `Notification` and `PushManager`.
- The current permission is `"default"` (not yet asked) or `"denied"` (to show a helpful message).
- We do NOT render it if permission is already `"granted"`.

It uses `useGetV1PushVapidKey` (generated by Kubb) to fetch the public key, and the `requestPushPermission` helper from `lib/push.ts`. State is stored in the Zustand `ui-store` to avoid re-showing the prompt after the user interacts.

```tsx
import { Button } from "@/components/ui/button";
import { requestPushPermission } from "@/lib/push";
import { useGetV1PushVapidKey } from "@paper/api-client";
import { useState } from "react";

/**
 * PushOptIn — "Enable notifications" button rendered on the dashboard.
 *
 * Only visible if:
 * - The browser supports push notifications
 * - Permission has not yet been granted
 * - The user has not dismissed the prompt in this session
 *
 * After granting, the component removes itself.
 * If permission is denied by the browser, we render a short info message.
 */
export function PushOptIn() {
  const [dismissed, setDismissed] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "granted" | "denied" | "error">(
    "idle",
  );

  const { data: vapidData } = useGetV1PushVapidKey({ query: { staleTime: Infinity } });

  // Guard: hide if push isn't supported
  if (typeof window === "undefined" || !("Notification" in window) || !("PushManager" in window)) {
    return null;
  }

  // Hide if already granted or user dismissed
  if (Notification.permission === "granted" || dismissed || state === "granted") {
    return null;
  }

  // Show informational message if permission was explicitly denied
  if (Notification.permission === "denied" || state === "denied") {
    return (
      <p className="text-center text-xs text-ink/50">
        Notifications are blocked. Enable them in your browser settings to get daily reminders.
      </p>
    );
  }

  async function handleEnable() {
    if (!vapidData?.vapid_public_key) return;

    setState("loading");
    try {
      const apiBase = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";
      // Access token is managed by the http-client singleton — we need to read it
      // from localStorage via the auth module since push.ts doesn't have access
      // to the in-memory token held by @paper/api-client.
      const storedRefresh = localStorage.getItem("paper.refresh_token");
      if (!storedRefresh) {
        setState("error");
        return;
      }
      // Re-use the fetch helper from lib/auth indirectly: the access token lives
      // in the api-client module singleton. We call the raw fetch in lib/push.ts
      // which reads the token from the Authorization header. To get the current
      // access token, import getAccessToken from @paper/api-client (exposed by
      // the http-client).
      //
      // If @paper/api-client does not yet expose getAccessToken, fall back to
      // reading from the module-level token store used by bootstrapAuth.
      // In either case the token is short-lived (15 min) so this is safe.
      const { getAccessToken } = await import("@paper/api-client");
      const token = getAccessToken();
      if (!token) {
        setState("error");
        return;
      }

      await requestPushPermission(vapidData.vapid_public_key, apiBase, token);
      setState("granted");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("denied")) {
        setState("denied");
      } else {
        setState("error");
        setDismissed(true);
      }
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3">
      <p className="text-sm text-ink/70">Get daily reminders and streak alerts</p>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDismissed(true)}
          className="text-ink/40"
        >
          Not now
        </Button>
        <Button
          size="sm"
          onClick={() => void handleEnable()}
          disabled={state === "loading" || !vapidData}
        >
          {state === "loading" ? "…" : "Enable"}
        </Button>
      </div>
    </div>
  );
}
```

> **Note on `getAccessToken`:** The `@paper/api-client` `http-client.ts` module exposes `setAccessToken` but may not yet export `getAccessToken`. If it doesn't, add `export function getAccessToken(): string | null { return _accessToken; }` to `packages/api-client/http-client.ts` (outside the Kubb-generated `src/` directory). Verify during implementation.

- [ ] Create `apps/web/src/components/dashboard/PushOptIn.tsx`.
- [ ] Check `packages/api-client/http-client.ts` for `getAccessToken` and add it if missing.

### Step 7.5 — Wire `PushOptIn` into the dashboard

Add the component below the action buttons grid and above `<LearnCTA />`:

```tsx
// apps/web/src/routes/dashboard.tsx
import { AssetList } from "@/components/dashboard/AssetList";
import { HeroPortfolioCard } from "@/components/dashboard/HeroPortfolioCard";
import { LearnCTA } from "@/components/dashboard/LearnCTA";
import { PushOptIn } from "@/components/dashboard/PushOptIn";
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
        <div className="grid grid-cols-2 gap-3">
          <Button asChild trailing="→" fullWidth>
            <Link to="/trade">Place a trade</Link>
          </Button>
          <Button asChild variant="secondary" trailing="→" fullWidth>
            <Link to="/learn">Learn</Link>
          </Button>
        </div>
        <PushOptIn />
        <LearnCTA />
        <TopMoversStrip />
        <AssetList />
      </div>
    </main>
  );
}
```

- [ ] Add `PushOptIn` import and `<PushOptIn />` to `apps/web/src/routes/dashboard.tsx`.

### Step 7.6 — Verify web build

```bash
pnpm --filter @paper/web build
```

Build must succeed with zero TypeScript errors. Verify `dist/sw.js` is present in the output.

```bash
ls apps/web/dist/sw.js
```

- [ ] Run `pnpm --filter @paper/web build` and confirm `dist/sw.js` is present.

### Step 7.7 — Typecheck web

```bash
pnpm --filter @paper/web typecheck
```

- [ ] Confirm web typecheck passes with zero errors.

---

## Task 8: Lab deployment — update K8s manifest + document VAPID secret

**Files:**
- Modify: `/Users/filipkastovsky/work/personal/lab/stacks/paper/manifests/20-paper-api-deployment.yaml`

### Step 8.1 — Add VAPID env vars to API deployment manifest

Add two new `env` entries to the `paper-api` container spec, after the `JWT_SECRET` entry:

```yaml
# /Users/filipkastovsky/work/personal/lab/stacks/paper/manifests/20-paper-api-deployment.yaml
# (excerpt — full env block after edit):

env:
  - name: NODE_ENV
    value: production
  - name: HOST
    value: 0.0.0.0
  - name: PORT
    value: "3000"
  - name: DATABASE_URL
    valueFrom: { secretKeyRef: { name: paper-db-password, key: dsn } }
  - name: REDIS_URL
    valueFrom: { secretKeyRef: { name: paper-app, key: REDIS_URL } }
  - name: JWT_SECRET
    valueFrom: { secretKeyRef: { name: paper-app, key: JWT_SECRET } }
  - name: VAPID_PUBLIC_KEY
    valueFrom: { secretKeyRef: { name: paper-app, key: VAPID_PUBLIC_KEY } }
  - name: VAPID_PRIVATE_KEY
    valueFrom: { secretKeyRef: { name: paper-app, key: VAPID_PRIVATE_KEY } }
  - name: LOG_LEVEL
    value: info
  - name: OTEL_SERVICE_NAME
    value: paper-api
  # OTel + Loki/Tempo wired via cluster-level Grafana Alloy in a follow-up step
```

- [ ] Add `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` env entries to `20-paper-api-deployment.yaml`.

### Step 8.2 — Generate and store VAPID keys in K8s secret (one-time, on developer machine)

```bash
# 1. Generate keys — run ONCE; save output somewhere safe (e.g. 1Password)
npx web-push generate-vapid-keys
# Output:
#   Public Key:  <your-public-key>
#   Private Key: <your-private-key>

# 2. Patch the existing `paper-app` secret with the new keys
kubectl patch secret paper-app -n paper --type=merge \
  -p '{
    "stringData": {
      "VAPID_PUBLIC_KEY": "<your-public-key>",
      "VAPID_PRIVATE_KEY": "<your-private-key>"
    }
  }'

# 3. Verify the secret was updated (values are base64-encoded in etcd)
kubectl get secret paper-app -n paper -o jsonpath='{.data.VAPID_PUBLIC_KEY}' | base64 -d
```

> If the `paper-app` secret does not yet exist, create it:
> ```bash
> kubectl create secret generic paper-app -n paper \
>   --from-literal=REDIS_URL="redis://<host>:<port>" \
>   --from-literal=JWT_SECRET="<secret>" \
>   --from-literal=VAPID_PUBLIC_KEY="<key>" \
>   --from-literal=VAPID_PRIVATE_KEY="<key>"
> ```

### Step 8.3 — Deploy

After committing the manifest change and pushing the new container image:

```bash
# Apply the updated deployment manifest
kubectl apply -f /Users/filipkastovsky/work/personal/lab/stacks/paper/manifests/20-paper-api-deployment.yaml

# Confirm the rollout completes
kubectl rollout status deployment/paper-api -n paper

# Tail logs to verify VAPID init and no startup crash
kubectl logs -f deployment/paper-api -n paper --tail=50
```

- [ ] Apply the updated manifest and confirm the rollout completes without errors.
- [ ] Verify API logs show no VAPID config errors on startup.

---

## Self-review checklist

### Correctness
- [ ] `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are `z.string().min(1)` — Zod rejects empty strings at startup.
- [ ] `web-push` default import works under NodeNext ESM via Node's CJS interop — `webPush.setVapidDetails` is a function on the default export.
- [ ] `sendPush` returns `"gone"` on HTTP 410 and re-throws all other errors — callers handle cleanup.
- [ ] `subscribeUser` uses `onConflictDoUpdate` on `endpoint` — idempotent re-subscribe from same browser.
- [ ] `unsubscribeUser` is a no-op if the endpoint is not found — DELETE WHERE is safe.
- [ ] The scheduler is gated on `NODE_ENV === "production"` — never fires in tests or local dev.
- [ ] The scheduler catches errors per-tick with `try/catch` and logs at `warn` — one bad tick doesn't crash the process.
- [ ] `streak_at_risk` query uses `lt(streaks.lastQualifyingActionAt, dayStartUtc)` — compares timestamps correctly with the start of the current UTC day.
- [ ] `daily_question_live` fans out to ALL subscribers (not per-user) — `pushSubscriptions` table is queried without a `userId` filter.
- [ ] `PushOptIn` hides itself when `Notification.permission === "granted"` — no duplicate prompts on re-visit.
- [ ] `sw.ts` calls `precacheAndRoute(self.__WB_MANIFEST)` — the VitePWA build injects the manifest at the right place.
- [ ] `notificationclick` tries to focus an existing window before opening a new one — avoids duplicate tabs.
- [ ] `navigateFallback` is removed from the `workbox` config in `vite.config.ts` — `injectManifest` mode doesn't support `navigateFallback` in the plugin config; it must be added manually in `sw.ts` via `NavigationRoute` if needed. (Deferred: the existing app uses hash routing fallback from the server, so this is not blocking for Plan 8.)

### Security
- [ ] Private VAPID key is never logged, never included in the OpenAPI spec, never sent to the client.
- [ ] `GET /v1/push/vapid-key` returns only the public key.
- [ ] `POST /v1/push/subscribe` and `POST /v1/push/unsubscribe` require JWT auth — a user can only subscribe/unsubscribe their own endpoints.
- [ ] The example dummy VAPID keys in `test/helpers/server.ts` are clearly labelled "NOT for production".

### Tests
- [ ] Service tests mock `web-push` at module level — no network calls during test run.
- [ ] Route tests use `makeTestServer` which sets `NODE_ENV: "test"` — scheduler never fires.
- [ ] `truncateAllTables` includes `push_subscriptions` — no test pollution between suites.
- [ ] All `afterAll` hooks close `ctx.app` and `ctx.sql` — no open handles warnings.

### Migrations
- [ ] `push_subscriptions` migration runs after Plans 5–7 migrations — numbered `0008_*.sql`.
- [ ] Migration includes the unique index on `endpoint` and the FK with `ON DELETE CASCADE`.
- [ ] `pnpm db:migrate` is run locally before testing routes that insert subscription rows.

### Web
- [ ] `dist/sw.js` is present after `vite build` — VitePWA correctly picks up `src/sw.ts`.
- [ ] Workbox runtime caching routes in `sw.ts` match the previous `runtimeCaching` config (no regressions to API caching behaviour).
- [ ] `PushOptIn` renders `null` on browsers without `Notification` or `PushManager` (SSR/jsdom safe).
- [ ] `@paper/api-client` exports `getAccessToken` — verify or add to `http-client.ts`.

### Lab
- [ ] VAPID keys are in the `paper-app` K8s secret before applying the updated deployment.
- [ ] Deployment rollout confirms no `CrashLoopBackOff` after adding the two new env vars.
