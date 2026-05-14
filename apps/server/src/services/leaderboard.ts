import type { Db } from "@/db/client.js";
import { leaderboardSnapshots, users } from "@/db/schema/index.js";
import { asc, eq, sql } from "drizzle-orm";

export function currentWeekSunday(now: Date = new Date()): string {
  const day = now.getUTCDay();
  const diff = -day;
  const sunday = new Date(now);
  sunday.setUTCDate(now.getUTCDate() + diff);
  return sunday.toISOString().slice(0, 10);
}

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

export async function weeklyReset(db: Db): Promise<void> {
  await db.delete(leaderboardSnapshots);
}

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

export async function getLeaderboard(
  db: Db,
  callerId: string,
  limit: number,
): Promise<GetLeaderboardResult> {
  const weekStartingDate = currentWeekSunday();

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
