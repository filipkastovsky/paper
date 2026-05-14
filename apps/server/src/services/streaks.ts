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
  const todayUtc = now.toISOString().slice(0, 10);

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
    await db.update(streaks).set({ lastQualifyingActionAt: now }).where(eq(streaks.userId, userId));
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
