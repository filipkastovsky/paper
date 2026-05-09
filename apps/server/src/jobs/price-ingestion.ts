import { loadConfig } from "../config.js";
import { fetchAndCacheAllPrices } from "../services/prices.js";
import { closeRedis } from "../services/redis.js";

export async function runPriceIngestion(): Promise<{ ok: number; failed: number }> {
  const config = loadConfig();
  const result = await fetchAndCacheAllPrices(config.REDIS_URL);
  return result;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  try {
    const { ok, failed } = await runPriceIngestion();
    const elapsedMs = Date.now() - t0;
    console.info(
      JSON.stringify({ event: "price_ingestion_done", ok, failed, elapsed_ms: elapsedMs }),
    );
    if (failed > 0 && ok === 0) {
      // Hard failure — all symbols missed. K8s sees non-zero exit.
      process.exit(2);
    }
    process.exit(0);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "price_ingestion_error",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    process.exit(1);
  } finally {
    await closeRedis();
  }
}

// Only run main when invoked as a script — not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
