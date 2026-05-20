/**
 * Playwright config for the Plan 2 production audit at https://papercrypto.tech.
 * Verifies the full onboarding-to-dashboard flow after the react-query
 * peerDependencies fix landed in commit 906a9f3.
 *
 * Run:
 *   pnpm --filter @paper/web exec playwright test --config=playwright.p2-audit.config.ts --reporter=list
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /p2-prod-audit\.spec\.ts$/,
  timeout: 90_000,
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: "https://papercrypto.tech",
    trace: "retain-on-failure",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
  },
  projects: [{ name: "chromium-mobile", use: { ...devices["iPhone 14"] } }],
});
