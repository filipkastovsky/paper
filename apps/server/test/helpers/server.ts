import { loadConfig } from "@/config.js";
import { buildServer } from "@/server.js";

export async function makeTestServer() {
  const config = loadConfig({
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/paper",
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
    JWT_SECRET: "test-secret-must-be-at-least-32-characters-long",
    LOG_LEVEL: "fatal",
  } as NodeJS.ProcessEnv);
  const app = await buildServer({ config });
  await app.ready();
  return app;
}
