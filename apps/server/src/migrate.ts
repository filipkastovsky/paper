import { migrate } from "drizzle-orm/postgres-js/migrator";
import { loadConfig } from "./config.js";
import { makeDb } from "./db/client.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, sql } = makeDb(config.DATABASE_URL);
  console.info("running migrations against", config.DATABASE_URL.replace(/:.+@/, ":***@"));
  await migrate(db, { migrationsFolder: "drizzle" });
  await sql.end();
  console.info("migrations applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
