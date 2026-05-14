import { loadConfig } from "../config.js";
import { makeDb } from "../db/client.js";
import { getOrCreateTodayQuestion, resolveYesterdayQuestion } from "../services/daily-questions.js";
import { awardPayouts } from "../services/predictions.js";
import { closeRedis } from "../services/redis.js";

/**
 * Daily question cron — runs at 00:00 UTC.
 *
 * Steps (order is intentional):
 *   1. Resolve yesterday's question (sets directionResolved + resolvedAt).
 *   2. Award payouts to yesterday's predictors (correct=stake*2, wrong=0, tie=stake).
 *   3. Create today's question (picks asset by day-of-year rotation, fetches baseline price).
 *
 * Exit codes:
 *   0  — all steps succeeded
 *   1  — unexpected error (exception thrown)
 */

async function runDailyQuestion(): Promise<void> {
  const config = loadConfig();
  const handles = makeDb(config.DATABASE_URL, { max: 4 });

  try {
    // Step 1: Resolve yesterday's question (idempotent — safe if already done).
    const resolved = await resolveYesterdayQuestion(handles.db, config.REDIS_URL);

    if (resolved) {
      console.info(
        JSON.stringify({
          event: "daily_question_resolved",
          date: resolved.date,
          asset_id: resolved.assetId,
          direction: resolved.directionResolved,
        }),
      );

      // Step 2: Award payouts to yesterday's predictors.
      if (resolved.directionResolved) {
        const { awarded } = await awardPayouts(
          handles.db,
          resolved.id,
          resolved.directionResolved as "up" | "down" | "tie",
        );
        console.info(
          JSON.stringify({
            event: "daily_question_payouts_awarded",
            question_id: resolved.id,
            date: resolved.date,
            direction: resolved.directionResolved,
            predictions_resolved: awarded,
          }),
        );
      }
    } else {
      console.info(JSON.stringify({ event: "daily_question_no_yesterday" }));
    }

    // Step 3: Create today's question.
    const today = await getOrCreateTodayQuestion(handles.db, config.REDIS_URL);
    console.info(
      JSON.stringify({
        event: "daily_question_created",
        date: today.date,
        asset_id: today.assetId,
        baseline_price_usd: today.baselinePriceUsd,
      }),
    );
  } finally {
    await handles.sql.end();
    await closeRedis();
  }
}

async function main(): Promise<void> {
  const t0 = Date.now();
  try {
    await runDailyQuestion();
    const elapsedMs = Date.now() - t0;
    console.info(JSON.stringify({ event: "daily_question_cron_done", elapsed_ms: elapsedMs }));
    process.exit(0);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "daily_question_cron_error",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }),
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
