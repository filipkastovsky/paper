import { loadConfig } from "@/config.js";
import { type DbHandles, makeDb } from "@/db/client.js";
import { buildServer } from "@/server.js";

export interface TestServer {
  app: Awaited<ReturnType<typeof buildServer>>;
  db: DbHandles["db"];
  sql: DbHandles["sql"];
  config: ReturnType<typeof loadConfig>;
}

export async function makeTestServer(): Promise<TestServer> {
  const config = loadConfig({
    ...process.env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/paper",
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
    // Dummy VAPID keys — example values, safe for tests only, NOT for production
    VAPID_PUBLIC_KEY:
      "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
    VAPID_PRIVATE_KEY: "UUxI4O8-HoSvQnHBrfWEPljd0-m7QkGCHJaFqHQBTMs",
    JWT_SECRET: "test-secret-must-be-at-least-32-characters-long",
    LOG_LEVEL: "fatal",
  });
  const handles = makeDb(config.DATABASE_URL, { max: 2 });
  const app = await buildServer({ config, db: handles.db });
  await app.ready();
  return { app, db: handles.db, sql: handles.sql, config };
}
