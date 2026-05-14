import { makeDb } from "@/db/client.js";
import { leaderboardSnapshots, portfolios, users } from "@/db/schema/index.js";
import { getLeaderboard, recomputeLeaderboard, weeklyReset } from "@/services/leaderboard.js";
import { closeRedis } from "@/services/redis.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { truncateAllTables } from "../helpers/db.js";

const dbUrl = process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/paper";

function currentWeekSunday(): string {
  const d = new Date();
  const day = d.getUTCDay();
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
    const [u] = await handles.db.insert(users).values({ deviceUuid }).returning({ id: users.id });
    if (!u) throw new Error("no user");
    await handles.db
      .insert(portfolios)
      .values({ userId: u.id, cashUsd: "10000.00000000", holdings: {} });
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

  it("user with default $10k cash has composite_score of 0", async () => {
    const userId = await seedUser("00000000-0000-0000-0000-00000000lb02");
    const weekSunday = currentWeekSunday();

    await recomputeLeaderboard(handles.db, weekSunday);

    const [row] = await handles.db
      .select()
      .from(leaderboardSnapshots)
      .where(eq(leaderboardSnapshots.userId, userId));

    expect(row?.compositeScore).toBe(0);
  });

  it("user with $11000 cash gets +10 from portfolio component", async () => {
    const userId = await seedUser("00000000-0000-0000-0000-00000000lb03");
    const weekSunday = currentWeekSunday();

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

    await handles.db
      .update(portfolios)
      .set({ cashUsd: "15000.00000000" })
      .where(eq(portfolios.userId, userA));

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
    const [u] = await handles.db
      .insert(users)
      .values({ deviceUuid: "00000000-0000-0000-0000-00000000lb07" })
      .returning({ id: users.id });
    if (!u) throw new Error("no user");
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
    await handles.db
      .insert(portfolios)
      .values({ userId: u.id, cashUsd: "10000.00000000", holdings: {} });
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

    await handles.db
      .update(portfolios)
      .set({ cashUsd: "13000.00000000" })
      .where(eq(portfolios.userId, userA));
    await handles.db
      .update(portfolios)
      .set({ cashUsd: "12000.00000000" })
      .where(eq(portfolios.userId, userB));

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
    for (let i = 0; i < 5; i++) {
      await seedUser(`00000000-0000-0000-0000-00000000lb${13 + i}`);
    }
    const weekSunday = currentWeekSunday();
    await recomputeLeaderboard(handles.db, weekSunday);

    const lastUserId = (await handles.db.select({ id: users.id }).from(users))[4]?.id;
    if (!lastUserId) throw new Error("no user");

    const result = await getLeaderboard(handles.db, lastUserId, 3);

    expect(result.entries).toHaveLength(3);
  });

  it("returns my_entry for the caller even if outside the top-N limit", async () => {
    const userIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const uid = await seedUser(`00000000-0000-0000-0000-00000000lb${18 + i}`);
      userIds.push(uid);
    }

    for (let i = 0; i < 4; i++) {
      await handles.db
        .update(portfolios)
        .set({ cashUsd: `${12000 + i * 500}.00000000` })
        .where(eq(portfolios.userId, userIds[i] as string));
    }

    const weekSunday = currentWeekSunday();
    await recomputeLeaderboard(handles.db, weekSunday);

    const callerId = userIds[4] as string;
    const result = await getLeaderboard(handles.db, callerId, 3);

    expect(result.entries).toHaveLength(3);
    expect(result.my_entry).not.toBeNull();
    expect(result.my_entry?.rank).toBe(5);
    expect(result.my_entry?.user_id).toBe(callerId);
  });

  it("includes handle in entries", async () => {
    const userId = await seedUser("00000000-0000-0000-0000-00000000lb23");
    const weekSunday = currentWeekSunday();
    await recomputeLeaderboard(handles.db, weekSunday);

    const result = await getLeaderboard(handles.db, userId, 50);

    expect(result.entries[0]).toHaveProperty("handle");
    expect(result.entries[0]?.handle).toBe("user_lb23");
  });
});
