import { Redis } from "ioredis";

let _redis: Redis | null = null;

export function getRedis(redisUrl: string): Redis {
  if (_redis) return _redis;
  _redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: false });
  return _redis;
}

/** Test/shutdown only. Closes the singleton so the next getRedis() reconnects. */
export async function closeRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}
