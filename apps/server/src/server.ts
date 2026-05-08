import Fastify, { type FastifyInstance } from "fastify";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { Config } from "./config.js";
import { registerSwagger } from "./plugins/swagger.js";
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
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "*.password",
          "*.token",
          "*.refresh_token",
          "*.access_token",
        ],
        censor: "[REDACTED]",
      },
    },
    disableRequestLogging: false,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await registerSwagger(app);
  await app.register(healthRoutes);

  return app;
}

export type AppInstance = FastifyInstance;
