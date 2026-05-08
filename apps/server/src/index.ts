import { loadConfig } from "./config.js";
import { makeDb } from "./db/client.js";
import { startOtel } from "./plugins/otel.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const otel = startOtel(config); // no-op if OTEL_EXPORTER_OTLP_ENDPOINT unset
  const handles = makeDb(config.DATABASE_URL);
  const app = await buildServer({ config, db: handles.db });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutdown initiated");
    try {
      await app.close();
      await handles.sql.end();
      await otel?.shutdown();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "shutdown failed");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
