/**
 * Playwright config for the live-site audit. Skips the local webServer so
 * the spec can run against production without spinning up dev servers.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /live-audit\.spec\.ts$/,
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
  },
  projects: [{ name: "chromium-mobile", use: { ...devices["iPhone 14"] } }],
});
