import { loadConfig } from "../config.js";
import { makeDb } from "../db/client.js";
import { closeRedis } from "../services/redis.js";
import { runDailySnapshot } from "../services/snapshots.js";

export async function runDailyPortfolioSnapshot(): Promise<{
  ok: number;
  failed: number;
  date: string;
}> {
  const config = loadConfig();
  // The job iterates one user at a time inside `runDailySnapshot`, so a small
  // pool keeps the cron polite to Postgres while still allowing a couple of
  // concurrent reads (the cron's only consumer of this DB instance).
  const handles = makeDb(config.DATABASE_URL, { max: 4 });
  try {
    const result = await runDailySnapshot(handles.db, config.REDIS_URL);
    return result;
  } finally {
    await handles.sql.end();
  }
}

async function main(): Promise<void> {
  const t0 = Date.now();
  try {
    const { ok, failed, date } = await runDailyPortfolioSnapshot();
    const elapsedMs = Date.now() - t0;
    console.info(
      JSON.stringify({
        event: "daily_snapshot_done",
        ok,
        failed,
        date,
        elapsed_ms: elapsedMs,
      }),
    );
    if (failed > 0 && ok === 0) {
      // All users failed — surface as a non-zero exit so K8s flags the Job.
      process.exit(2);
    }
    process.exit(0);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "daily_snapshot_error",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    process.exit(1);
  } finally {
    await closeRedis();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
