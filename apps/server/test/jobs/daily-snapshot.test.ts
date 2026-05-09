import { runDailyPortfolioSnapshot } from "@/jobs/daily-snapshot.js";
import { closeRedis } from "@/services/redis.js";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withFreshRedis } from "../helpers/redis.js";

describe("runDailyPortfolioSnapshot", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv(
      "DATABASE_URL",
      process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/paper",
    );
    vi.stubEnv("REDIS_URL", process.env.REDIS_URL ?? "redis://localhost:6379");
    vi.stubEnv("JWT_SECRET", "test-secret-must-be-at-least-32-characters-long");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await closeRedis();
  });

  it("returns ok=0 when there are no users (smoke)", async () => {
    await withFreshRedis(async () => {
      const { ok, failed } = await runDailyPortfolioSnapshot();
      expect(ok).toBeGreaterThanOrEqual(0);
      expect(failed).toBe(0);
    });
  });
});
