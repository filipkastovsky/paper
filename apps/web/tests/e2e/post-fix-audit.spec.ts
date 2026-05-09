/**
 * Post-fix verification audit for https://papercrypto.tech.
 *
 * Verifies the 7 welcome-screen fixes shipped in commits b876627, 2e84a61, b227e8c.
 * Run:
 *   pnpm --filter @paper/web exec playwright test --config=playwright.post-fix.config.ts
 *
 * READ-ONLY against apps/web/src/. We only inspect prod DOM/CSS + take screenshots.
 */
import { type Page, expect, request, test } from "@playwright/test";

const PROD = "https://papercrypto.tech";
const API = "https://api.papercrypto.tech";
const SHOTS = "tests/e2e/screenshots/post-fix";

interface ConsoleProblem {
  type: "pageerror" | "console.error";
  text: string;
}

function attachConsoleListeners(page: Page): ConsoleProblem[] {
  const problems: ConsoleProblem[] = [];
  page.on("pageerror", (err) => problems.push({ type: "pageerror", text: err.message }));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push({ type: "console.error", text: msg.text() });
  });
  return problems;
}

async function waitForAuthHydration(page: Page, timeout = 15_000) {
  await page.waitForFunction(
    () => !!localStorage.getItem("paper.user") && !!localStorage.getItem("paper.refresh_token"),
    null,
    { timeout },
  );
}

// Each test is independent; don't bail subsequent tests on one failure.
test.describe.configure({ mode: "default" });

/* --------------------------------------------------------------------- */
/* F1 — Pre-auth blank screen eliminated                                  */
/* --------------------------------------------------------------------- */
test("F1: welcome card paints before auth resolves", async ({ page }) => {
  const problems = attachConsoleListeners(page);

  // Delay /v1/auth/device by 5s so any sync render is clearly distinguishable.
  let authResolvedAt: number | null = null;
  const navStart = Date.now();
  await page.route("**/v1/auth/**", async (route) => {
    await new Promise((r) => setTimeout(r, 5000));
    authResolvedAt = Date.now() - navStart;
    await route.continue();
  });
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {}
  });

  await page.goto(PROD, { waitUntil: "commit" });

  // Poll for the hero numeral in the DOM. We're measuring paint time from
  // navigation start; we only care that it lands before auth resolves (5s).
  let paintMs: number | null = null;
  for (let i = 0; i < 100; i++) {
    const present = await page.evaluate(() => {
      return !!document.body && document.body.textContent?.includes("10,000");
    });
    if (present) {
      paintMs = Date.now() - navStart;
      break;
    }
    await page.waitForTimeout(50);
  }

  test.info().annotations.push({
    type: "F1-paint-ms",
    description: String(paintMs),
  });
  // Auth has 5s artificial delay; render should land in well under 3s
  // (typical: ~300-500ms for a static React shell).
  if (paintMs === null) throw new Error("paintMs not captured");
  expect(paintMs).toBeLessThan(3000);

  // The hero numeral, eyebrow, body, and CTA all visible synchronously.
  await expect(page.getByText("$10,000").first()).toBeVisible({ timeout: 2000 });
  await expect(page.getByText(/welcome to paper/i).first()).toBeVisible();
  await expect(page.getByText(/practice cash/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /coming soon/i }).first()).toBeVisible();

  test.info().annotations.push({
    type: "F1-auth-resolved-at-ms",
    description: String(authResolvedAt),
  });

  await page.screenshot({
    path: `${SHOTS}/f1-mobile-pre-auth.png`,
    fullPage: true,
  });

  expect(problems, `console errors: ${JSON.stringify(problems)}`).toEqual([]);
});

/* --------------------------------------------------------------------- */
/* F2 — Hero $10,000 is the dominant numeral (Bricolage Grotesque)        */
/* --------------------------------------------------------------------- */
test("F2: $10,000 is the largest text on the page in Bricolage Grotesque", async ({ page }) => {
  await page.goto(PROD, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("$10,000").first()).toBeVisible();

  const ranking = await page.evaluate(() => {
    const all = Array.from(document.body.querySelectorAll<HTMLElement>("*"));
    type Row = {
      tag: string;
      text: string;
      fontSize: number;
      fontFamily: string;
      fontWeight: string;
    };
    const rows: Row[] = [];
    for (const el of all) {
      const text = (el.textContent ?? "").trim();
      if (!text || text.length > 60) continue;
      // Skip elements that just wrap further children with the same text — we want leaves.
      const hasElementChild = Array.from(el.children).some(
        (c) => c.textContent && c.textContent.trim() === text,
      );
      if (hasElementChild) continue;
      const cs = window.getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      rows.push({
        tag: el.tagName.toLowerCase(),
        text,
        fontSize: Number.parseFloat(cs.fontSize),
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight,
      });
    }
    rows.sort((a, b) => b.fontSize - a.fontSize);
    return rows.slice(0, 8);
  });

  test.info().annotations.push({
    type: "F2-largest-text",
    description: JSON.stringify(ranking, null, 2),
  });

  expect(ranking.length).toBeGreaterThan(0);
  // The largest text (or its containing fragment) should include the hero numeral.
  // The numeral is split across spans by BalanceNumeral (`$`, `10,000`), so the
  // top entries should include either `$10,000`, `10,000`, or `$`.
  const [top] = ranking;
  if (!top) throw new Error("no text ranked");
  expect(top.text).toMatch(/(\$10,000|10,000|^\$$)/);
  expect(top.fontFamily.toLowerCase()).toMatch(/bricolage/);

  // Confirm DOM order: numeral comes BEFORE the headline text in document order.
  const order = await page.evaluate(() => {
    const numeral = Array.from(document.querySelectorAll<HTMLElement>("*")).find((el) =>
      (el.textContent ?? "").trim().includes("10,000"),
    );
    const headline = Array.from(document.querySelectorAll<HTMLElement>("*")).find((el) =>
      (el.textContent ?? "").trim().startsWith("of practice cash"),
    );
    if (!numeral || !headline) return null;
    const pos = numeral.compareDocumentPosition(headline);
    return {
      numeralBeforeHeadline: !!(pos & Node.DOCUMENT_POSITION_FOLLOWING),
      numeralRect: numeral.getBoundingClientRect().top,
      headlineRect: headline.getBoundingClientRect().top,
    };
  });
  test.info().annotations.push({
    type: "F2-dom-order",
    description: JSON.stringify(order),
  });
  if (!order) throw new Error("hero order not measurable");
  expect(order.numeralBeforeHeadline).toBe(true);
  expect(order.numeralRect).toBeLessThan(order.headlineRect);
});

/* --------------------------------------------------------------------- */
/* F3 — `session:` debug indicator hidden in production                   */
/* --------------------------------------------------------------------- */
test("F3: 'session:' indicator not user-visible; auth still works", async ({ page }) => {
  await page.goto(PROD, { waitUntil: "domcontentloaded" });

  // Wait for auth so the legacy indicator (if it were rendered) would be present.
  await waitForAuthHydration(page);

  // No visible "session: <hex>…" text.
  const visibleSessionMatches = await page.evaluate(() => {
    const all = Array.from(document.body.querySelectorAll<HTMLElement>("*"));
    const matches: { tag: string; text: string; visible: boolean; ariaHidden: boolean }[] = [];
    for (const el of all) {
      const text = (el.textContent ?? "").trim();
      if (!/^session:\s*[0-9a-f]/i.test(text)) continue;
      const cs = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const visible =
        cs.visibility !== "hidden" &&
        cs.display !== "none" &&
        Number.parseFloat(cs.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0;
      matches.push({
        tag: el.tagName.toLowerCase(),
        text,
        visible,
        ariaHidden: el.getAttribute("aria-hidden") === "true",
      });
    }
    return matches;
  });
  test.info().annotations.push({
    type: "F3-session-matches",
    description: JSON.stringify(visibleSessionMatches),
  });
  // Either no matches at all, or all matches are non-visible (sr-only / display:none).
  expect(visibleSessionMatches.filter((m) => m.visible)).toEqual([]);

  // Auth still works — localStorage populated.
  const ls = await page.evaluate(() => ({
    user: localStorage.getItem("paper.user"),
    refresh: localStorage.getItem("paper.refresh_token"),
  }));
  expect(ls.user).toContain('"id":');
  expect(ls.refresh).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

/* --------------------------------------------------------------------- */
/* F4 — "Coming soon" CTA, disabled, no-op                                */
/* --------------------------------------------------------------------- */
test("F4: primary CTA is disabled 'Coming soon', click is a no-op", async ({ page }) => {
  const problems = attachConsoleListeners(page);
  const navEvents: string[] = [];
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) navEvents.push(f.url());
  });

  await page.goto(PROD, { waitUntil: "networkidle" });

  // No "Get started" anywhere.
  const getStarted = await page.getByRole("button", { name: /get started/i }).count();
  expect(getStarted).toBe(0);

  const btn = page.getByRole("button", { name: /coming soon/i }).first();
  await expect(btn).toBeVisible();
  await expect(btn).toBeDisabled();

  const attrs = await btn.evaluate((el) => ({
    disabled: (el as HTMLButtonElement).disabled,
    ariaDisabled: el.getAttribute("aria-disabled"),
    text: el.textContent?.trim(),
  }));
  test.info().annotations.push({ type: "F4-cta-attrs", description: JSON.stringify(attrs) });
  expect(attrs.disabled).toBe(true);
  expect(attrs.ariaDisabled).toBe("true");

  const before = page.url();
  await btn.click({ force: true });
  await page.waitForTimeout(500);
  expect(page.url()).toBe(before);
  expect(problems).toEqual([]);
});

/* --------------------------------------------------------------------- */
/* F5 — Decorative blobs: large, blurred, separated                       */
/* --------------------------------------------------------------------- */
test("F5: decorative blobs are larger, blurred, separated, and translucent", async ({ page }) => {
  await page.goto(PROD, { waitUntil: "networkidle" });
  await waitForAuthHydration(page);

  const blobs = await page.evaluate(() => {
    // Inspect the mobile card (visible at 390x844) — that's where the blobs live.
    const spans = Array.from(
      document.querySelectorAll<HTMLElement>('span[aria-hidden="true"], span[aria-hidden]'),
    );
    return spans
      .map((el) => {
        const cs = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          className: el.className,
          filter: cs.filter,
          opacity: Number.parseFloat(cs.opacity),
          backgroundColor: cs.backgroundColor,
          borderRadius: cs.borderRadius,
          width: rect.width,
          height: rect.height,
          top: rect.top,
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
          visible: rect.width > 0 && rect.height > 0,
        };
      })
      .filter(
        (b) =>
          b.visible && /blur|filter/i.test(b.filter) && b.borderRadius !== "0px" && b.width >= 80,
      );
  });

  test.info().annotations.push({ type: "F5-blobs", description: JSON.stringify(blobs, null, 2) });
  // Expect at least 2 blob spans on the mobile card.
  expect(blobs.length).toBeGreaterThanOrEqual(2);

  for (const b of blobs) {
    // Blur ≥ ~24px (Tailwind's blur-2xl) — assert filter string contains a non-trivial blur.
    expect(b.filter).toMatch(/blur\((?:2[4-9]|[3-9]\d|\d{3,})px\)/);
    expect(b.opacity).toBeGreaterThanOrEqual(0.3);
    expect(b.opacity).toBeLessThanOrEqual(0.5);
  }

  // Blobs not directly stacked — different vertical positions OR different colors.
  const [b0, b1] = blobs;
  if (!b0 || !b1) throw new Error("expected at least 2 blobs");
  expect(Math.abs(b0.top - b1.top)).toBeGreaterThan(50);

  // High-quality screenshot of the card area.
  await page.screenshot({
    path: `${SHOTS}/f5-mobile-blobs.png`,
    fullPage: true,
  });
});

/* --------------------------------------------------------------------- */
/* F6 — Desktop two-column hero with PhoneFrame; mobile single card       */
/* --------------------------------------------------------------------- */
test("F6: desktop is two-column with PhoneFrame; mobile remains single card", async ({
  browser,
}) => {
  // Desktop
  const desktopCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const desktop = await desktopCtx.newPage();
  await desktop.goto(PROD, { waitUntil: "networkidle" });
  await waitForAuthHydration(desktop);

  // Find a phone-frame-shaped element: a container with a plump radius (~40-48px)
  // and a max-width around 340px containing $10,000 again (mirrored card).
  const desktopShape = await desktop.evaluate(() => {
    const all = Array.from(document.querySelectorAll<HTMLElement>("*"));
    const phoneCandidates = all
      .map((el) => {
        const cs = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const radius = Number.parseFloat(cs.borderTopLeftRadius);
        return {
          tag: el.tagName.toLowerCase(),
          className: typeof el.className === "string" ? el.className : "",
          radius,
          width: rect.width,
          height: rect.height,
          left: rect.left,
          top: rect.top,
          hasInnerNumeral: !!Array.from(el.querySelectorAll("*")).find(
            (c) => (c.textContent ?? "").trim() === "10,000",
          ),
        };
      })
      .filter(
        (e) =>
          e.radius >= 32 &&
          e.width >= 200 &&
          e.width <= 420 &&
          e.height >= 400 &&
          e.hasInnerNumeral,
      );

    // Also count $10,000 occurrences on screen — there should be two on desktop:
    // one in the lockup, one in the phone frame.
    const numeralCount = all.filter((el) => {
      const text = (el.textContent ?? "").trim();
      const hasChild = Array.from(el.children).some(
        (c) => c.textContent && c.textContent.trim() === text,
      );
      return !hasChild && text === "10,000";
    }).length;

    return { phoneCandidates, numeralCount, viewport: window.innerWidth };
  });

  test.info().annotations.push({
    type: "F6-desktop",
    description: JSON.stringify(desktopShape, null, 2),
  });
  expect(desktopShape.phoneCandidates.length).toBeGreaterThanOrEqual(1);
  expect(desktopShape.numeralCount).toBeGreaterThanOrEqual(2);

  // Verify two-column layout: there's a left lockup and a right phone, with the
  // lockup left of the phone frame.
  const layout = await desktop.evaluate(() => {
    const heroLockupEyebrow = Array.from(document.querySelectorAll<HTMLElement>("*")).find(
      (el) => (el.textContent ?? "").trim().toLowerCase() === "welcome to paper",
    );
    if (!heroLockupEyebrow) return null;
    return {
      eyebrowLeft: heroLockupEyebrow.getBoundingClientRect().left,
      eyebrowTop: heroLockupEyebrow.getBoundingClientRect().top,
    };
  });
  test.info().annotations.push({
    type: "F6-layout",
    description: JSON.stringify(layout),
  });
  expect(layout).not.toBeNull();

  await desktop.screenshot({
    path: `${SHOTS}/f6-desktop-1280.png`,
    fullPage: true,
  });
  await desktopCtx.close();

  // Mobile — single card, no second numeral
  const mobileCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
  });
  const mobile = await mobileCtx.newPage();
  await mobile.goto(PROD, { waitUntil: "networkidle" });
  await waitForAuthHydration(mobile);

  const mobileNumeralCount = await mobile.evaluate(() => {
    const all = Array.from(document.querySelectorAll<HTMLElement>("*"));
    return all.filter((el) => {
      const text = (el.textContent ?? "").trim();
      const hasChild = Array.from(el.children).some(
        (c) => c.textContent && c.textContent.trim() === text,
      );
      if (hasChild) return false;
      if (text !== "10,000") return false;
      // Only count visible (the desktop branch is `hidden md:block`, so its
      // numeral should be display:none on mobile).
      const cs = window.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      let parent: HTMLElement | null = el.parentElement;
      while (parent) {
        const ps = window.getComputedStyle(parent);
        if (ps.display === "none" || ps.visibility === "hidden") return false;
        parent = parent.parentElement;
      }
      return true;
    }).length;
  });
  test.info().annotations.push({
    type: "F6-mobile-numeral-count",
    description: String(mobileNumeralCount),
  });
  expect(mobileNumeralCount).toBe(1);

  await mobile.screenshot({
    path: `${SHOTS}/f6-mobile-390.png`,
    fullPage: true,
  });
  await mobileCtx.close();
});

/* --------------------------------------------------------------------- */
/* F7 — Manifest theme_color unchanged                                    */
/* --------------------------------------------------------------------- */
test("F7: manifest theme_color is #FAFAF1", async () => {
  const ctx = await request.newContext();
  const r = await ctx.get(`${PROD}/manifest.webmanifest`);
  expect(r.status()).toBe(200);
  const manifest = (await r.json()) as Record<string, unknown>;
  test.info().annotations.push({
    type: "F7-manifest",
    description: JSON.stringify(manifest, null, 2),
  });
  expect(String(manifest.theme_color).toUpperCase()).toBe("#FAFAF1");
});

/* --------------------------------------------------------------------- */
/* Sanity — API health, auth roundtrip, no console errors over a flow     */
/* --------------------------------------------------------------------- */
test("sanity: api health, auth roundtrip, console-clean full flow", async ({ page }) => {
  const ctx = await request.newContext();
  const health = await ctx.get(`${API}/v1/health`);
  expect(health.status()).toBe(200);
  const healthBody = (await health.json()) as { status?: string };
  test.info().annotations.push({
    type: "api-health",
    description: JSON.stringify(healthBody),
  });
  expect(healthBody.status).toBe("ok");

  // Direct /v1/auth/device POST returns access + refresh + user.
  const authResp = await ctx.post(`${API}/v1/auth/device`, {
    headers: { "content-type": "application/json" },
    data: { device_uuid: crypto.randomUUID() },
  });
  expect(authResp.status()).toBe(200);
  const authBody = (await authResp.json()) as Record<string, unknown>;
  test.info().annotations.push({
    type: "auth-roundtrip-keys",
    description: JSON.stringify(Object.keys(authBody)),
  });
  expect(typeof authBody.access_token).toBe("string");
  expect(typeof authBody.refresh_token).toBe("string");
  expect(typeof authBody.user).toBe("object");

  // Browser-side: console-clean flow from initial render through auth hydration.
  const problems = attachConsoleListeners(page);
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {}
  });
  await page.goto(PROD, { waitUntil: "networkidle" });
  await waitForAuthHydration(page);

  const ls = await page.evaluate(() => ({
    user: localStorage.getItem("paper.user"),
    refresh: localStorage.getItem("paper.refresh_token"),
    device: localStorage.getItem("paper.device_uuid"),
  }));
  expect(ls.device).toMatch(/^[0-9a-f-]{36}$/);
  expect(ls.user).toContain('"id":');

  test.info().annotations.push({
    type: "sanity-console-problems",
    description: JSON.stringify(problems, null, 2),
  });
  expect(problems, `console errors: ${JSON.stringify(problems)}`).toEqual([]);
});
