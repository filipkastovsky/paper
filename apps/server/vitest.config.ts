import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["test/**/*.test.ts"],
    setupFiles: [],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    // Tests share a single Postgres database and a single Redis instance via
    // helpers (`truncateAllTables`, `withFreshRedis`). Running test files in
    // parallel races on those shared stores — e.g. one file flushes Redis
    // mid-assertion of another. A single fork serialises file execution while
    // still isolating from the parent; the suite is small enough that the
    // wall-clock cost is negligible.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
});
