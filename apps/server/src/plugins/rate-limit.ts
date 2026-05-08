import type { Config } from "@/config.js";
import fastifyRateLimit from "@fastify/rate-limit";
import fp from "fastify-plugin";
import { Redis } from "ioredis";

export const rateLimitPlugin = fp(async (app, opts: { config: Config }) => {
  const redis = new Redis(opts.config.REDIS_URL, { maxRetriesPerRequest: 1 });
  await app.register(fastifyRateLimit, {
    redis,
    global: false, // opt-in per route in v0
    max: 100,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.headers["x-forwarded-for"]?.toString() ?? req.ip,
  });
  app.addHook("onClose", async () => {
    redis.disconnect();
  });
});
