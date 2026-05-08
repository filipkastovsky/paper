import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer({ config });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutdown initiated");
    try {
      await app.close();
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
