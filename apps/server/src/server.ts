import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import { healthRoutes } from "./routes/health.js";

export interface BuildServerOptions {
  config: Config;
}

export async function buildServer({ config }: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } }
          : undefined,
    },
    disableRequestLogging: false,
  });

  await app.register(healthRoutes);

  return app;
}
