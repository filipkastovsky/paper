import { migrate } from "drizzle-orm/postgres-js/migrator";
import { loadConfig } from "./config.js";
import { makeDb } from "./db/client.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, sql } = makeDb(config.DATABASE_URL, { max: 1 });
  console.info("running migrations against", config.DATABASE_URL.replace(/:.+@/, ":***@"));
  try {
    await migrate(db, { migrationsFolder: "drizzle" });
    console.info("migrations applied");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
