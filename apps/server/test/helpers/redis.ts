import { Redis } from "ioredis";

const url = process.env.REDIS_URL ?? "redis://localhost:6379";

export async function withFreshRedis<T>(fn: (r: Redis) => Promise<T>): Promise<T> {
  const r = new Redis(url, { maxRetriesPerRequest: 1 });
  try {
    await r.flushdb();
    return await fn(r);
  } finally {
    await r.quit();
  }
}
