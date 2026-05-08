import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["test/**/*.test.ts"],
    setupFiles: [],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
});
