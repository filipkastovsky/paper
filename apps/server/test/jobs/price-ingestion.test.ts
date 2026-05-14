import { runPriceIngestion } from "@/jobs/price-ingestion.js";
import { closeRedis } from "@/services/redis.js";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withFreshRedis } from "../helpers/redis.js";

describe("runPriceIngestion", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // loadConfig() inside runPriceIngestion validates the full server env; the
    // job only actually reads REDIS_URL, but the schema demands DATABASE_URL
    // and JWT_SECRET too. Stub the minimum so the parse succeeds.
    vi.stubEnv(
      "DATABASE_URL",
      process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/paper",
    );
    vi.stubEnv("REDIS_URL", process.env.REDIS_URL ?? "redis://localhost:6379");
    // Dummy VAPID keys — example values, safe for tests only, NOT for production
    vi.stubEnv(
      "VAPID_PUBLIC_KEY",
      "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
    );
    vi.stubEnv("VAPID_PRIVATE_KEY", "UUxI4O8-HoSvQnHBrfWEPljd0-m7QkGCHJaFqHQBTMs");
    vi.stubEnv("JWT_SECRET", "test-secret-must-be-at-least-32-characters-long");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await closeRedis();
  });

  it("populates Redis with all 12 prices", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const symbol = new URL(String(input)).searchParams.get("symbol") ?? "X";
        return new Response(JSON.stringify({ symbol, lastPrice: "100", prevClosePrice: "99" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    await withFreshRedis(async (r) => {
      const result = await runPriceIngestion();
      expect(result.ok).toBe(12);
      expect(result.failed).toBe(0);
      const keys = await r.keys("paper:price:*");
      expect(keys).toHaveLength(12);
    });
  });
});
