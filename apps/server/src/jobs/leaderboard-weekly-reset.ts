import { loadConfig } from "../config.js";
import { makeDb } from "../db/client.js";
import { currentWeekSunday, recomputeLeaderboard, weeklyReset } from "../services/leaderboard.js";

async function main(): Promise<void> {
  const t0 = Date.now();
  const config = loadConfig();
  const handles = makeDb(config.DATABASE_URL, { max: 4 });
  const newWeekSunday = currentWeekSunday();

  try {
    await weeklyReset(handles.db);
    console.info(
      JSON.stringify({ event: "leaderboard_weekly_reset_done", new_week: newWeekSunday }),
    );

    await recomputeLeaderboard(handles.db, newWeekSunday);
    const elapsedMs = Date.now() - t0;
    console.info(
      JSON.stringify({
        event: "leaderboard_weekly_reset_recompute_done",
        new_week: newWeekSunday,
        elapsed_ms: elapsedMs,
      }),
    );
    process.exit(0);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "leaderboard_weekly_reset_error",
        new_week: newWeekSunday,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    process.exit(1);
  } finally {
    await handles.sql.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
