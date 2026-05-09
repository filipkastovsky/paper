import { makeDb } from "@/db/client.js";
import { portfolioSnapshots, portfolios, users } from "@/db/schema/index.js";
import { closeRedis } from "@/services/redis.js";
import {
  ensureTodaySnapshot,
  runDailySnapshot,
  todayPctChange,
  todaySnapshotKey,
} from "@/services/snapshots.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { truncateAllTables } from "../helpers/db.js";
import { withFreshRedis } from "../helpers/redis.js";

const dbUrl = process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/paper";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

// ─── todaySnapshotKey ────────────────────────────────────────────────────────

describe("todaySnapshotKey", () => {
  it("returns YYYY-MM-DD in UTC", () => {
    const d = new Date("2026-05-09T23:59:00Z");
    expect(todaySnapshotKey(d)).toBe("2026-05-09");
  });

  it("doesn't roll on local midnight — stays UTC", () => {
    // 2026-05-10T00:30:00Z is already May 10 UTC — must NOT return May 9.
    const d = new Date("2026-05-10T00:30:00Z");
    expect(todaySnapshotKey(d)).toBe("2026-05-10");
  });
});

// ─── ensureTodaySnapshot ─────────────────────────────────────────────────────

describe("ensureTodaySnapshot", () => {
  const handles = makeDb(dbUrl, { max: 2 });

  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  async function seedUser(deviceUuid = "00000000-0000-0000-0000-00000000bb01"): Promise<string> {
    const [u] = await handles.db.insert(users).values({ deviceUuid }).returning({ id: users.id });
    if (!u) throw new Error("no user inserted");
    await handles.db
      .insert(portfolios)
      .values({ userId: u.id, cashUsd: "10000.00000000", holdings: {} });
    return u.id;
  }

  it("inserts a snapshot row when none exists and returns created=true", async () => {
    await withFreshRedis(async () => {
      const userId = await seedUser();
      const result = await ensureTodaySnapshot(handles.db, redisUrl, userId);
      expect(result.created).toBe(true);
      const rows = await handles.db
        .select()
        .from(portfolioSnapshots)
        .where(eq(portfolioSnapshots.userId, userId));
      expect(rows).toHaveLength(1);
    });
  });

  it("is idempotent — second call returns created=false and keeps one row", async () => {
    await withFreshRedis(async () => {
      const userId = await seedUser();
      const first = await ensureTodaySnapshot(handles.db, redisUrl, userId);
      const second = await ensureTodaySnapshot(handles.db, redisUrl, userId);
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      const rows = await handles.db
        .select()
        .from(portfolioSnapshots)
        .where(eq(portfolioSnapshots.userId, userId));
      expect(rows).toHaveLength(1);
    });
  });
});

// ─── todayPctChange ──────────────────────────────────────────────────────────

describe("todayPctChange", () => {
  const handles = makeDb(dbUrl, { max: 2 });

  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  async function seedUser(deviceUuid = "00000000-0000-0000-0000-00000000cc01"): Promise<string> {
    const [u] = await handles.db.insert(users).values({ deviceUuid }).returning({ id: users.id });
    if (!u) throw new Error("no user inserted");
    return u.id;
  }

  it("returns null when no snapshot exists for today", async () => {
    const userId = await seedUser();
    const result = await todayPctChange(handles.db, {
      userId,
      currentTotalUsd: "10500.00000000",
    });
    expect(result).toBeNull();
  });

  it("computes 5% change correctly for $10k open → $10500 current", async () => {
    const userId = await seedUser();
    const today = todaySnapshotKey();
    await handles.db.insert(portfolioSnapshots).values({
      userId,
      snapshotDate: today,
      totalValueUsd: "10000.00000000",
    });
    const result = await todayPctChange(handles.db, {
      userId,
      currentTotalUsd: "10500.00000000",
      now: new Date(`${today}T12:00:00Z`),
    });
    expect(result).toBe(5);
  });
});

// ─── runDailySnapshot ────────────────────────────────────────────────────────

describe("runDailySnapshot", () => {
  const handles = makeDb(dbUrl, { max: 2 });

  afterEach(async () => {
    await truncateAllTables(handles.db);
  });
  afterAll(async () => {
    await handles.sql.end();
    await closeRedis();
  });

  async function seedUser(deviceUuid: string): Promise<string> {
    const [u] = await handles.db.insert(users).values({ deviceUuid }).returning({ id: users.id });
    if (!u) throw new Error("no user inserted");
    await handles.db
      .insert(portfolios)
      .values({ userId: u.id, cashUsd: "10000.00000000", holdings: {} });
    return u.id;
  }

  it("writes one snapshot row per user and returns ok=1, failed=0", async () => {
    await withFreshRedis(async () => {
      await seedUser("00000000-0000-0000-0000-00000000dd01");
      const result = await runDailySnapshot(handles.db, redisUrl);
      expect(result.ok).toBe(1);
      expect(result.failed).toBe(0);
      const rows = await handles.db.select().from(portfolioSnapshots);
      expect(rows).toHaveLength(1);
    });
  });

  it("is idempotent — second run keeps one row per user", async () => {
    await withFreshRedis(async () => {
      await seedUser("00000000-0000-0000-0000-00000000ee01");
      await runDailySnapshot(handles.db, redisUrl);
      const second = await runDailySnapshot(handles.db, redisUrl);
      expect(second.ok).toBe(1);
      const rows = await handles.db.select().from(portfolioSnapshots);
      expect(rows).toHaveLength(1);
    });
  });
});
