import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { loadConfig } from "./config.js";
import { makeDb } from "./db/client.js";

// Anchor migrations folder to this script's location, not process.cwd().
// dev (tsx src/migrate.ts):  here=apps/server/src,  ../drizzle = apps/server/drizzle
// prod (node dist/migrate.js): here=apps/server/dist, ../drizzle = apps/server/drizzle
// container (cwd=/app):       here=/app/apps/server/dist, ../drizzle = /app/apps/server/drizzle
const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, "../drizzle");

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, sql } = makeDb(config.DATABASE_URL, { max: 1 });
  console.info("running migrations against", config.DATABASE_URL.replace(/:.+@/, ":***@"));
  try {
    await migrate(db, { migrationsFolder });
    console.info("migrations applied");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
