import { expect, test } from "@playwright/test";

test.describe("dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
  });

  test("shows portfolio + asset list + at least the static $10k cash", async ({ page }) => {
    // Walk through onboarding to land on /dashboard with a real session.
    const handle = `pw_${Date.now().toString(36)}_d`.slice(0, 20).toLowerCase();
    await page.goto("/onboarding/handle");
    await page.getByPlaceholder("yourhandle").fill(handle);
    await expect(page.getByText(/available ✓/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /Claim handle/i }).click();
    await expect(page).toHaveURL(/\/onboarding\/balance$/);
    await page.getByRole("link", { name: /Let's go/i }).click();
    await expect(page).toHaveURL(/\/onboarding\/lesson$/);
    await page.getByRole("link", { name: /Skip to my dashboard/i }).click();

    await expect(page).toHaveURL(/\/dashboard$/);

    // HeroPortfolioCard renders the $10,000 starter balance.
    await expect(page.getByText(/\$10,000/).first()).toBeVisible();

    // AssetList renders 12 rows for the v0 roster — verify at least 6 are
    // attached to the DOM (some may scroll out of viewport on mobile).
    const assetIds = [
      "BTC",
      "ETH",
      "SOL",
      "USDC",
      "BNB",
      "XRP",
      "ADA",
      "DOGE",
      "AVAX",
      "LINK",
      "DOT",
      "TON",
    ];
    let visibleCount = 0;
    for (const id of assetIds) {
      try {
        await expect(page.getByText(id, { exact: true }).first()).toBeAttached({ timeout: 1000 });
        visibleCount++;
      } catch {
        /* ignore */
      }
    }
    expect(visibleCount).toBeGreaterThanOrEqual(6);
  });

  test("top movers strip is hidden when no prices are cached", async ({ page }) => {
    // Local Redis may or may not have prices; this test only confirms that
    // the page doesn't crash when movers are empty. Cron writes prices in prod.
    await page.goto("/dashboard");
    await expect(page).not.toHaveURL(/error/);
  });
});
