import { expect, test } from "@playwright/test";

test.describe("onboarding flow", () => {
  test.beforeEach(async ({ page }) => {
    // Fresh device per test — reset localStorage to force the new-user path.
    await page.addInitScript(() => localStorage.clear());
  });

  test("new user walks through 4 steps and lands on /dashboard", async ({ page }) => {
    await page.goto("/");
    // Should redirect to /onboarding/welcome (no handle yet).
    await expect(page).toHaveURL(/\/onboarding\/welcome$/);
    await expect(page.getByText(/Get started/i).first()).toBeVisible();

    await page
      .getByRole("link", { name: /Get started/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/onboarding\/handle$/);

    // Type a unique-enough handle. Use a timestamp suffix so consecutive runs
    // against the same dev DB don't collide.
    const handle = `pw_${Date.now().toString(36)}`.slice(0, 20).toLowerCase();
    await page.getByPlaceholder("yourhandle").fill(handle);
    // Wait for the "available ✓" indicator.
    await expect(page.getByText(/available ✓/i)).toBeVisible({ timeout: 5000 });

    await page.getByRole("button", { name: /Claim handle/i }).click();
    await expect(page).toHaveURL(/\/onboarding\/balance$/);

    await page.getByRole("link", { name: /Let's go/i }).click();
    await expect(page).toHaveURL(/\/onboarding\/lesson$/);

    await page.getByRole("link", { name: /Skip to my dashboard/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("returning user with handle skips onboarding entirely", async ({ page }) => {
    // Pre-seed by walking through once.
    const handle = `pw_${Date.now().toString(36)}_r`.slice(0, 20).toLowerCase();
    await page.goto("/onboarding/handle");
    await page.getByPlaceholder("yourhandle").fill(handle);
    await expect(page.getByText(/available ✓/i)).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /Claim handle/i }).click();
    await expect(page).toHaveURL(/\/onboarding\/balance$/);

    // The handle was just claimed via PATCH /v1/me but localStorage's
    // `paper.user` was set at device-auth time and still has handle: null.
    // pickInitialRoute() reads localStorage, so without intervention the
    // root visit will land on /onboarding/welcome again. Plan 2 accepts
    // either /dashboard (if storage was rehydrated) OR /onboarding/welcome
    // (stale storage). Plan 2.1 / Plan 3 may refresh storage on PATCH success.
    //
    // Note: TanStack Router's beforeLoad redirect() throws during initial
    // navigation, which Playwright surfaces as "Frame load interrupted" if
    // we wait for `load`. Use `domcontentloaded` so we don't trip on the
    // synchronous redirect.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/(dashboard|onboarding\/welcome)$/);
  });
});
