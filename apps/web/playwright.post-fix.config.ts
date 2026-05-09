/**
 * Playwright config for the post-fix audit at https://papercrypto.tech.
 * Runs only the post-fix-audit spec, no local webServer.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /post-fix-audit\.spec\.ts$/,
  timeout: 60_000,
  retries: 1,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
  },
  projects: [{ name: "chromium-mobile", use: { ...devices["iPhone 14"] } }],
});
