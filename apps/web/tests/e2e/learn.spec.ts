import { expect, test } from "@playwright/test";

async function onboardAndGoToDashboard(page: import("@playwright/test").Page, suffix: string) {
  const handle = `pw_${Date.now().toString(36)}_${suffix}`.slice(0, 20).toLowerCase();
  await page.goto("/onboarding/handle");
  await page.getByPlaceholder("yourhandle").fill(handle);
  await expect(page.getByText(/available ✓/i)).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: /Claim handle/i }).click();
  await page.getByRole("link", { name: /Let's go/i }).click();
  await page.getByRole("link", { name: /Skip to my dashboard/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  // Wait for all in-flight navigations to settle before the caller issues goto().
  await page.waitForLoadState("networkidle");
}

test.describe("learn flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
  });

  test("dashboard → learn → first lesson → correct quiz → completion recorded", async ({
    page,
  }) => {
    await onboardAndGoToDashboard(page, "l");

    await expect(page.getByText(/Start your first lesson/i)).toBeVisible();

    await page
      .getByRole("link", { name: /^Learn$/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/learn$/);

    await expect(page.getByText("Fundamentals")).toBeVisible();
    await expect(page.getByText("Markets")).toBeVisible();
    await expect(page.getByText("Safety")).toBeVisible();

    // Start the first Fundamentals lesson.
    // The router double-encodes the slash: fundamentals%252Fwhat-is-bitcoin
    await page
      .getByRole("link", { name: /^Start →$/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/learn\/fundamentals/);

    await expect(page.getByText("What is Bitcoin?")).toBeVisible();
    await expect(page.getByLabel("Lesson progress")).toBeVisible();

    // Click through the 4 prose steps.
    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: /Next →/i }).click();
    }

    // Now on quiz step.
    await expect(page.getByText(/What enforces Bitcoin's hard cap/i)).toBeVisible();

    // Select the correct answer (index 2 in the quiz options; the protocol code option).
    await page.getByRole("radio").nth(2).click();
    await page.getByRole("button", { name: /Check answer/i }).click();
    await expect(page.getByText(/Correct!/i)).toBeVisible();

    await page.getByRole("button", { name: /Complete lesson/i }).click();

    await expect(page.getByRole("link", { name: /Next lesson →/i })).toBeVisible({
      timeout: 5000,
    });

    // Verify progress propagates to /learn via SPA navigation (preserves auth token).
    await page.getByRole("link", { name: /← Lessons/i }).click();
    await expect(page).toHaveURL(/\/learn/);
    await expect(page.getByText(/1 \/ 10 done/i)).toBeVisible({ timeout: 10_000 });
  });

  test("/learn shows 0/N progress for a brand-new user", async ({ page }) => {
    await onboardAndGoToDashboard(page, "l2");
    await page.goto("/learn");

    const trackCards = await page.getByText(/0 \/ \d+ done/i).all();
    expect(trackCards.length).toBe(3);
  });

  test("wrong quiz answer shows 'Try again' and does not mark lesson complete", async ({
    page,
  }) => {
    await onboardAndGoToDashboard(page, "l3");

    // Navigate to the lesson via the learn hub so the router uses the correct URL encoding.
    await page.goto("/learn");
    await page
      .getByRole("link", { name: /^Start →$/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/learn\/fundamentals/);

    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: /Next →/i }).click();
    }

    // Tap the first option (likely wrong; the polished quiz has the correct answer at index 2).
    const options = page.locator("button[aria-checked]");
    await options.first().click();
    await page.getByRole("button", { name: /Check answer/i }).click();

    await expect(page.getByText(/Not quite/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Complete lesson/i })).not.toBeVisible();

    await page.getByRole("button", { name: /Try again/i }).click();
    await expect(page.getByRole("button", { name: /Check answer/i })).toBeVisible();
  });
});
