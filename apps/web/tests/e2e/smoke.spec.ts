import { expect, test } from "@playwright/test";

/** Wait until bootstrapAuth has populated localStorage (keys appear together). */
async function waitForAuthHydration(page: import("@playwright/test").Page) {
  await page.waitForFunction(
    () => !!localStorage.getItem("paper.user") && !!localStorage.getItem("paper.refresh_token"),
    null,
    { timeout: 10_000 },
  );
}

test("first load creates a device session and renders welcome", async ({ page }) => {
  // Clear localStorage before any page scripts run so we deterministically
  // observe a "first load" — without this, repeated runs against the same dev
  // server reuse a previously-stored device UUID. Doing it via addInitScript
  // (vs goto -> evaluate -> goto) avoids a "navigation interrupted" flake on
  // WebKit when the second goto starts before the first commits.
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {
      // ignore — runs before the document has a usable storage origin.
    }
  });
  await page.goto("/");

  // Welcome screen renders synchronously now — assert the hero numeral
  // (which is the actual hero per Marshmallow §4, not the headline) appears
  // before auth resolves.
  await expect(page.getByText("$10,000").first()).toBeVisible();
  await expect(page.getByText(/practice cash/i).first()).toBeVisible();

  // Auth happens in the background; wait for storage hydration.
  await waitForAuthHydration(page);

  const ls = await page.evaluate(() => ({
    device: localStorage.getItem("paper.device_uuid"),
    refresh: localStorage.getItem("paper.refresh_token"),
    user: localStorage.getItem("paper.user"),
  }));
  expect(ls.device).toMatch(/^[0-9a-f-]{36}$/);
  expect(ls.refresh).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(ls.user).toContain('"id":');
});

test("second load reuses the existing session (refresh path)", async ({ page }) => {
  await page.goto("/");
  await waitForAuthHydration(page);
  const firstUser = await page.evaluate(() => localStorage.getItem("paper.user"));

  await page.reload();
  await waitForAuthHydration(page);
  const secondUser = await page.evaluate(() => localStorage.getItem("paper.user"));

  expect(secondUser).toBe(firstUser);
});
