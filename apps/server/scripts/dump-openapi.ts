import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { makeDb } from "../src/db/client.js";
import { buildServer } from "../src/server.js";

async function main(): Promise<void> {
  const config = loadConfig({
    ...process.env,
    NODE_ENV: "development",
    HOST: "127.0.0.1",
    DATABASE_URL: "postgres://app:app@localhost:5432/paper",
    REDIS_URL: "redis://localhost:6379",
    JWT_SECRET: "build-time-only-must-be-at-least-32-characters",
    LOG_LEVEL: "silent",
    OTEL_SERVICE_NAME: "paper-api",
    VAPID_PUBLIC_KEY:
      process.env.VAPID_PUBLIC_KEY ??
      "BGWDCW3A6reW9BT_wYVblsUbEq0cfrWcaDD70IC2h8Lb8ZOg-G5oo4Q6o6cbl1a_Q31Fxvqb7YQRC3z8TqZPtgI",
    VAPID_PRIVATE_KEY:
      process.env.VAPID_PRIVATE_KEY ?? "3vVTFRogW6WtC6UfIki1tjk1-UvoyEpS-_a5-uBgHVQ",
  });
  const handles = makeDb(config.DATABASE_URL, { max: 1 });
  const app = await buildServer({ config, db: handles.db });
  await app.ready();
  const spec = app.swagger();
  const here = dirname(fileURLToPath(import.meta.url));
  const out = resolve(here, "../../../packages/api-client/openapi.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(spec, null, 2));
  await app.close();
  await handles.sql.end();
  console.info(`wrote ${out}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
