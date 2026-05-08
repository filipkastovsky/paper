import { expect, test } from "@playwright/test";

test("first load creates a device session and renders welcome", async ({ page }) => {
  // Clear localStorage before navigating to ensure a fresh session.
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");

  await expect(page.getByText(/Learn crypto with \$10,000/i)).toBeVisible();
  await expect(page.getByTestId("user-id")).toContainText(/session:/);

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
  await expect(page.getByTestId("user-id")).toBeVisible();
  const firstId = await page.getByTestId("user-id").textContent();

  await page.reload();
  await expect(page.getByTestId("user-id")).toBeVisible();
  const secondId = await page.getByTestId("user-id").textContent();

  expect(secondId).toBe(firstId);
});
