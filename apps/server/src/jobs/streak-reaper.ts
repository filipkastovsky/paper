import { loadConfig } from "../config.js";
import { makeDb } from "../db/client.js";
import { reapExpiredStreaks } from "../services/streaks.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const handles = makeDb(config.DATABASE_URL, { max: 2 });
  const t0 = Date.now();
  try {
    const reaped = await reapExpiredStreaks(handles.db);
    console.info(
      JSON.stringify({
        event: "streak_reaper_done",
        reaped,
        elapsed_ms: Date.now() - t0,
      }),
    );
    process.exit(0);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "streak_reaper_error",
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
