import { makeDb } from "@/db/client.js";
import { streaks, users } from "@/db/schema/index.js";
import { closeRedis } from "@/services/redis.js";
import { getStreak, reapExpiredStreaks, upsertStreak } from "@/services/streaks.js";
import { eq } from "drizzle-orm";
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
    await upsertStreak(handles.db, userId);

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
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

    const twoDaysAgo = new Date();
    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);
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

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
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

    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
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
    expect(row?.longestDays).toBe(7);
  });

  it("does not touch users whose lastQualifyingActionAt is within 24h", async () => {
    const [u] = await handles.db
      .insert(users)
      .values({ deviceUuid: "00000000-0000-0000-0000-00000000sr08" })
      .returning({ id: users.id });
    if (!u) throw new Error("no user");

    const recent = new Date(Date.now() - 23 * 60 * 60 * 1000);
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
