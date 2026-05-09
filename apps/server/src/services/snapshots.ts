import type { Db } from "@/db/client.js";
import { portfolioSnapshots, users } from "@/db/schema/index.js";
import { Decimal } from "decimal.js";
import { and, eq } from "drizzle-orm";
import { getPortfolioWithValuation } from "./portfolio.js";

// ─── todaySnapshotKey ────────────────────────────────────────────────────────

/** Returns the current UTC date as `YYYY-MM-DD`. */
export function todaySnapshotKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// ─── ensureTodaySnapshot ─────────────────────────────────────────────────────

export type EnsureSnapshotResult = {
  /** `created` = inserted just now. `existed` = already had a row for today. `no_portfolio` = user has no portfolio (caller-contract violation). */
  kind: "created" | "existed" | "no_portfolio";
  date: string;
  /** Backwards-compat: true iff we inserted just now. */
  created: boolean;
};

/**
 * Idempotent insert of today's open snapshot for `userId`.
 * Uses composite PK `(user_id, snapshot_date)` with `onConflictDoNothing`,
 * so concurrent calls are safe — the DB constraint absorbs any race.
 *
 * If the user has no portfolio yet, returns `kind: "no_portfolio"` without
 * inserting. We deliberately don't insert a $0 row in that case — a future
 * "% today" derived from a $0 open would be nonsense (∞%). Every authenticated
 * user has a portfolio created at device-auth time, so this is a caller-contract
 * violation, not a normal flow.
 */
export async function ensureTodaySnapshot(
  db: Db,
  redisUrl: string,
  userId: string,
): Promise<EnsureSnapshotResult> {
  const date = todaySnapshotKey();

  const portfolio = await getPortfolioWithValuation(db, redisUrl, userId);
  if (!portfolio) {
    return { kind: "no_portfolio", date, created: false };
  }

  const inserted = await db
    .insert(portfolioSnapshots)
    .values({ userId, snapshotDate: date, totalValueUsd: portfolio.total_value_usd })
    .onConflictDoNothing({ target: [portfolioSnapshots.userId, portfolioSnapshots.snapshotDate] })
    .returning({ userId: portfolioSnapshots.userId });

  const wasCreated = inserted.length === 1;
  return {
    kind: wasCreated ? "created" : "existed",
    date,
    created: wasCreated,
  };
}

// ─── runDailySnapshot ────────────────────────────────────────────────────────

export type DailySnapshotResult = {
  ok: number;
  failed: number;
  date: string;
};

/**
 * Iterates every user, computes current `total_value_usd`, upserts a snapshot.
 * Per-user failures are caught, logged, and counted — other users still run.
 */
export async function runDailySnapshot(db: Db, redisUrl: string): Promise<DailySnapshotResult> {
  const date = todaySnapshotKey();
  const allUsers = await db.select({ id: users.id }).from(users);

  let ok = 0;
  let failed = 0;

  for (const user of allUsers) {
    try {
      const r = await ensureTodaySnapshot(db, redisUrl, user.id);
      if (r.kind === "no_portfolio") {
        console.warn(
          JSON.stringify({ event: "snapshot_skip_no_portfolio", userId: user.id, date }),
        );
        failed++;
      } else {
        ok++;
      }
    } catch (err) {
      console.warn(JSON.stringify({ event: "snapshot_failed", userId: user.id, err: String(err) }));
      failed++;
    }
  }

  return { ok, failed, date };
}

// ─── todayPctChange ──────────────────────────────────────────────────────────

/**
 * Computes `((current - open) / open) * 100` rounded to 4 decimal places.
 * Returns `null` if no snapshot exists for today or if `open <= 0`.
 */
export async function todayPctChange(
  db: Db,
  opts: { userId: string; currentTotalUsd: string; now?: Date },
): Promise<number | null> {
  const { userId, currentTotalUsd, now } = opts;
  const date = todaySnapshotKey(now);

  const [row] = await db
    .select({ totalValueUsd: portfolioSnapshots.totalValueUsd })
    .from(portfolioSnapshots)
    .where(and(eq(portfolioSnapshots.userId, userId), eq(portfolioSnapshots.snapshotDate, date)));

  if (!row) return null;

  const open = new Decimal(row.totalValueUsd);
  if (open.lte(0)) return null;

  const current = new Decimal(currentTotalUsd);
  return current.minus(open).div(open).mul(100).toDecimalPlaces(4).toNumber();
}
