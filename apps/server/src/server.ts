import fastifyCors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
// fastify-metrics ships CJS with `exports.default = plugin`, so the default
// import surfaces the wrapper namespace under NodeNext — use `.default`.
import fastifyMetricsPkg from "fastify-metrics";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { authPlugin } from "./plugins/auth.js";
import { rateLimitPlugin } from "./plugins/rate-limit.js";
import { registerSwagger } from "./plugins/swagger.js";
import { assetsRoutes } from "./routes/assets.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";

const fastifyMetrics = fastifyMetricsPkg.default;

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    config: Config;
  }
}

export interface BuildServerOptions {
  config: Config;
  db: Db;
}

export async function buildServer({ config, db }: BuildServerOptions): Promise<FastifyInstance> {
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
  app.decorate("db", db);
  app.decorate("config", config);

  // CORS — local Vite dev in development; the production web origin in production.
  // Web is on `papercrypto.tech` (and its `www.` alias + the .pages.dev fallback);
  // API is on `api.papercrypto.tech`, so the request is cross-origin and needs the
  // explicit allowlist.
  await app.register(fastifyCors, {
    origin:
      config.NODE_ENV === "production"
        ? [
            "https://papercrypto.tech",
            "https://www.papercrypto.tech",
            "https://paper-web.pages.dev",
          ]
        : ["http://localhost:5173", "http://127.0.0.1:5173"],
    credentials: true,
  });

  await app.register(authPlugin, { config });
  await app.register(fastifyMetrics, { endpoint: "/metrics", clearRegisterOnInit: true });
  await app.register(rateLimitPlugin, { config });
  await registerSwagger(app);
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(assetsRoutes);

  return app;
}

export type AppInstance = FastifyInstance;
