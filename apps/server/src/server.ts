import fastifyCors from "@fastify/cors";
import { and, eq, gt, lt } from "drizzle-orm";
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
import { dailyQuestions, pushSubscriptions, streaks } from "./db/schema/index.js";
import { authPlugin } from "./plugins/auth.js";
import { rateLimitPlugin } from "./plugins/rate-limit.js";
import { registerSwagger } from "./plugins/swagger.js";
import { assetsRoutes } from "./routes/assets.js";
import { authRoutes } from "./routes/auth.js";
import { dailyQuestionRoutes } from "./routes/daily-question.js";
import { healthRoutes } from "./routes/health.js";
import { leaderboardRoutes } from "./routes/leaderboard.js";
import { learnRoutes } from "./routes/learn.js";
import { meRoutes } from "./routes/me.js";
import { predictionsRoutes } from "./routes/predictions.js";
import { pushRoutes } from "./routes/push.js";
import { tradesRoutes } from "./routes/trades.js";
import { initWebPush, sendPush, sendToUser } from "./services/push.js";

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

  initWebPush({
    vapidPublicKey: config.VAPID_PUBLIC_KEY,
    vapidPrivateKey: config.VAPID_PRIVATE_KEY,
  });

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
    // Without `methods`, @fastify/cors falls back to "GET,HEAD,POST" and the
    // browser preflight rejects PATCH /v1/me + DELETE/PUT we'd add later.
    // Echo the verbs we actually expose; keep this in sync with new routes.
    methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });

  await app.register(authPlugin, { config });
  await app.register(fastifyMetrics, { endpoint: "/metrics", clearRegisterOnInit: true });
  await app.register(rateLimitPlugin, { config });
  await registerSwagger(app);
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(assetsRoutes);
  await app.register(meRoutes);
  await app.register(tradesRoutes);
  await app.register(learnRoutes);
  await app.register(dailyQuestionRoutes);
  await app.register(predictionsRoutes);
  await app.register(leaderboardRoutes);
  await app.register(pushRoutes);

  if (config.NODE_ENV === "production") {
    setInterval(
      async () => {
        const hour = new Date().getUTCHours();
        try {
          if (hour === 9) {
            const today = new Date().toISOString().slice(0, 10);
            const [question] = await db
              .select()
              .from(dailyQuestions)
              .where(eq(dailyQuestions.date, today));

            if (question) {
              const allSubs = await db.select().from(pushSubscriptions);
              for (const sub of allSubs) {
                await sendPush(sub, {
                  title: "Daily Question is live 📊",
                  body: `Will ${question.assetId} close up or down today?`,
                  tag: "daily_question_live",
                  url: "/",
                }).catch(() => {});
              }
            }
          }

          if (hour === 20) {
            const dayStartUtc = new Date();
            dayStartUtc.setUTCHours(0, 0, 0, 0);

            const atRisk = await db
              .select({ userId: streaks.userId })
              .from(streaks)
              .where(
                and(gt(streaks.currentDays, 0), lt(streaks.lastQualifyingActionAt, dayStartUtc)),
              );

            for (const { userId } of atRisk) {
              await sendToUser(db, userId, {
                title: "Streak at risk 🔥",
                body: "Complete a lesson or trade today to keep your streak alive.",
                tag: "streak_at_risk",
                url: "/",
              }).catch(() => {});
            }
          }
        } catch (err) {
          app.log.warn({ err }, "push scheduler error");
        }
      },
      60 * 60 * 1000,
    );
  }

  return app;
}

export type AppInstance = FastifyInstance;
