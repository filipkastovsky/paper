import type { Db } from "@/db/client.js";
import { type DailyQuestion, dailyQuestions } from "@/db/schema/index.js";
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
export async function getOrCreateTodayQuestion(db: Db, redisUrl: string): Promise<DailyQuestion> {
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
