import { Redis } from "ioredis";

let _redis: Redis | null = null;

export function getRedis(redisUrl: string): Redis {
  if (_redis) return _redis;
  _redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: false });
  return _redis;
}

/**
 * Test/shutdown only. Closes the singleton so the next getRedis() reconnects.
 *
 * Caller contract: do not race this with in-flight ops. Tests should `await`
 * any pending work first; production callers should only invoke during
 * graceful shutdown when no further requests will land.
 */
export async function closeRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}
