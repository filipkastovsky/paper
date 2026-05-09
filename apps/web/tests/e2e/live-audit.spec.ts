/**
 * Live audit of https://papercrypto.tech.
 *
 * These tests intentionally bypass the local dev `webServer` config in
 * `playwright.config.ts` by hitting absolute production URLs, so they can be
 * run in isolation with:
 *   pnpm --filter @paper/web exec playwright test live-audit
 *
 * The local webServer block still spins up — there is no per-spec opt-out —
 * but the tests below never depend on it.
 */
import { expect, request, test } from "@playwright/test";

const PROD = "https://papercrypto.tech";
const API = "https://api.papercrypto.tech";
const SHOTS = "tests/e2e/screenshots";

interface ConsoleProblem {
  type: "pageerror" | "console.error";
  text: string;
}

function attachConsoleListeners(page: import("@playwright/test").Page): ConsoleProblem[] {
  const problems: ConsoleProblem[] = [];
  page.on("pageerror", (err) => problems.push({ type: "pageerror", text: err.message }));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push({ type: "console.error", text: msg.text() });
  });
  return problems;
}

/** Wait until bootstrapAuth has populated localStorage. */
async function waitForAuthHydration(page: import("@playwright/test").Page, timeout = 15_000) {
  await page.waitForFunction(
    () => !!localStorage.getItem("paper.user") && !!localStorage.getItem("paper.refresh_token"),
    null,
    { timeout },
  );
}

test.describe.configure({ mode: "serial" });

test("1. prod root returns 200 with #root, manifest, sw.js", async () => {
  const ctx = await request.newContext();
  const home = await ctx.get(PROD);
  expect(home.status()).toBe(200);
  const html = await home.text();
  expect(html).toContain('<div id="root">');
  // manifest reference
  expect(html).toMatch(/manifest\.webmanifest|\/manifest/i);

  // service worker file is reachable
  const sw = await ctx.get(`${PROD}/sw.js`);
  expect([200, 304]).toContain(sw.status());
  const swText = await sw.text();
  expect(swText.length).toBeGreaterThan(50);

  // www mirror
  const www = await ctx.get("https://www.papercrypto.tech");
  expect([200, 301, 302, 308]).toContain(www.status());
});

test("2/3/4. boots without console errors, persists auth, hero numeral renders", async ({
  page,
}) => {
  const problems = attachConsoleListeners(page);
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {}
  });
  await page.goto(PROD, { waitUntil: "domcontentloaded" });

  // Welcome screen renders synchronously — the $10,000 hero numeral should
  // be visible before auth completes.
  await expect(page.getByText("$10,000").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/practice cash/i).first()).toBeVisible();

  // Auth happens in the background; verify it lands in localStorage.
  await waitForAuthHydration(page);

  await page.screenshot({
    path: `${SHOTS}/01-mobile-after-auth.png`,
    fullPage: true,
  });

  const ls = await page.evaluate(() => ({
    device: localStorage.getItem("paper.device_uuid"),
    refresh: localStorage.getItem("paper.refresh_token"),
    user: localStorage.getItem("paper.user"),
  }));
  expect(ls.device).toMatch(/^[0-9a-f-]{36}$/);
  expect(ls.refresh).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(ls.user).toContain('"id":');

  // attach as test info for the report
  test.info().annotations.push({
    type: "auth-payload",
    description: JSON.stringify(ls, null, 2),
  });
  test.info().annotations.push({
    type: "console-problems",
    description: JSON.stringify(problems, null, 2),
  });

  expect(problems, `console errors: ${JSON.stringify(problems)}`).toEqual([]);
});

test("5. PWA manifest is valid JSON with correct name + icons", async () => {
  const ctx = await request.newContext();
  // Vite-PWA defaults to /manifest.webmanifest
  const candidates = ["/manifest.webmanifest", "/manifest.json"];
  let manifest: Record<string, unknown> | null = null;
  let path = "";
  for (const p of candidates) {
    const r = await ctx.get(`${PROD}${p}`);
    if (r.ok()) {
      manifest = (await r.json()) as Record<string, unknown>;
      path = p;
      break;
    }
  }
  expect(manifest, `no manifest reachable at ${candidates.join(",")}`).not.toBeNull();
  expect(manifest?.name).toBe("paper");
  expect(Array.isArray(manifest?.icons)).toBe(true);
  expect((manifest?.icons as unknown[]).length).toBeGreaterThan(0);

  // each declared icon must actually load
  for (const icon of manifest?.icons as Array<{ src: string }>) {
    const r = await ctx.get(`${PROD}${icon.src}`);
    expect(r.status(), `icon ${icon.src}`).toBe(200);
  }
  test.info().annotations.push({ type: "manifest-path", description: path });
});

test("6. service worker registers + controls page on second load", async ({ page }) => {
  await page.goto(PROD, { waitUntil: "networkidle" });
  // First visit: SW activates async; trigger activation by reload.
  await page.reload({ waitUntil: "networkidle" });

  // Wait for ready and a controller — this is the standard browser-side check.
  const swState = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return { supported: false };
    const reg = await navigator.serviceWorker.getRegistration();
    await navigator.serviceWorker.ready;
    return {
      supported: true,
      hasController: !!navigator.serviceWorker.controller,
      hasRegistration: !!reg,
      scriptURL: reg?.active?.scriptURL ?? null,
      state: reg?.active?.state ?? null,
    };
  });
  test.info().annotations.push({ type: "sw-state", description: JSON.stringify(swState) });
  expect(swState.supported).toBe(true);
  expect(swState.hasRegistration).toBe(true);
  expect(swState.hasController).toBe(true);
});

test("7. reload preserves the session (refresh path)", async ({ page }) => {
  await page.goto(PROD, { waitUntil: "networkidle" });
  await waitForAuthHydration(page);
  const firstUser = await page.evaluate(() => localStorage.getItem("paper.user"));

  await page.reload({ waitUntil: "networkidle" });
  await waitForAuthHydration(page);
  const secondUser = await page.evaluate(() => localStorage.getItem("paper.user"));

  expect(secondUser).toBe(firstUser);
  expect(firstUser).toMatch(/"id":\s*"[0-9a-f-]{36}"/);
});

test("8. CORS: real fetch from page origin to api.papercrypto.tech succeeds", async ({ page }) => {
  await page.goto(PROD, { waitUntil: "networkidle" });
  const out = await page.evaluate(async (apiBase) => {
    try {
      const r = await fetch(`${apiBase}/v1/auth/device`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_uuid: crypto.randomUUID() }),
      });
      const data: unknown = r.ok ? await r.json() : null;
      return {
        ok: r.ok,
        status: r.status,
        accessControlAllowOrigin: r.headers.get("access-control-allow-origin"),
        hasAccessToken:
          typeof data === "object" &&
          data !== null &&
          typeof (data as { access_token?: unknown }).access_token === "string",
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }, API);
  test.info().annotations.push({ type: "cors-fetch", description: JSON.stringify(out) });
  expect(out.ok).toBe(true);
  expect(out.status).toBe(200);
  expect(out.hasAccessToken).toBe(true);
});

test("9. 'Coming soon' CTA — disabled, no navigation, no errors on click", async ({ page }) => {
  const problems = attachConsoleListeners(page);
  const navEvents: string[] = [];
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) navEvents.push(f.url());
  });

  await page.goto(PROD, { waitUntil: "networkidle" });
  // The CTA is now honest about its state.
  const btn = page.getByRole("button", { name: /coming soon/i }).first();
  await expect(btn).toBeVisible();
  await expect(btn).toBeDisabled();

  const initialUrl = page.url();
  const before = await page.evaluate(() => ({
    href: location.href,
    user: localStorage.getItem("paper.user"),
    refresh: localStorage.getItem("paper.refresh_token"),
  }));

  // Forced click bypasses Playwright's actionability checks (a disabled button
  // would otherwise fail the click). We want to assert that even when forced,
  // nothing breaks.
  await btn.click({ force: true });
  await page.waitForTimeout(500);

  const after = await page.evaluate(() => ({
    href: location.href,
    user: localStorage.getItem("paper.user"),
    refresh: localStorage.getItem("paper.refresh_token"),
  }));

  test.info().annotations.push({
    type: "click-result",
    description: JSON.stringify(
      {
        initialUrl,
        navEvents,
        urlChanged: before.href !== after.href,
        before,
        after,
        consoleProblems: problems,
      },
      null,
      2,
    ),
  });

  expect(after.user).toBe(before.user);
  expect(before.href).toBe(after.href);
  expect(problems).toEqual([]);
});

test("desktop screenshot at 1280x800", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(PROD, { waitUntil: "networkidle" });
  await waitForAuthHydration(page);
  await page.screenshot({ path: `${SHOTS}/02-desktop-1280.png`, fullPage: true });
  await ctx.close();
});

test("mobile reload screenshot", async ({ page }) => {
  await page.goto(PROD, { waitUntil: "networkidle" });
  await waitForAuthHydration(page);
  await page.reload({ waitUntil: "networkidle" });
  await waitForAuthHydration(page);
  await page.screenshot({ path: `${SHOTS}/03-mobile-after-reload.png`, fullPage: true });
});

test("initial render screenshot (pre-auth, very early)", async ({ page }) => {
  // Block the auth endpoint to capture the pre-auth render state.
  await page.route("**/v1/auth/**", async (route) => {
    await new Promise((r) => setTimeout(r, 5000));
    await route.continue();
  });
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {}
  });
  await page.goto(PROD, { waitUntil: "domcontentloaded" });
  // The hero numeral should appear immediately because render is no longer
  // blocked on auth (F1).
  await expect(page.getByText("$10,000").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-mobile-initial-render.png`, fullPage: true });
});
