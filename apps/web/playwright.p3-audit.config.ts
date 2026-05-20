/**
 * Playwright config for the Plan 3 production audit at https://papercrypto.tech.
 * Verifies the full trade execution flow after Plan 3 shipped.
 *
 * Run:
 *   pnpm --filter @paper/web exec playwright test --config=playwright.p3-audit.config.ts --reporter=list
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /p3-prod-audit\.spec\.ts$/,
  timeout: 90_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "https://papercrypto.tech",
    trace: "retain-on-failure",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
  },
  projects: [{ name: "chromium-mobile", use: { ...devices["iPhone 14"] } }],
});
