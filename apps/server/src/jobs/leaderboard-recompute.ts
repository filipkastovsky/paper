import { loadConfig } from "../config.js";
import { makeDb } from "../db/client.js";
import { currentWeekSunday, recomputeLeaderboard } from "../services/leaderboard.js";

async function main(): Promise<void> {
  const t0 = Date.now();
  const config = loadConfig();
  const handles = makeDb(config.DATABASE_URL, { max: 4 });
  const weekStartingDate = currentWeekSunday();

  try {
    await recomputeLeaderboard(handles.db, weekStartingDate);
    const elapsedMs = Date.now() - t0;
    console.info(
      JSON.stringify({
        event: "leaderboard_recompute_done",
        week_starting_date: weekStartingDate,
        elapsed_ms: elapsedMs,
      }),
    );
    process.exit(0);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "leaderboard_recompute_error",
        week_starting_date: weekStartingDate,
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
