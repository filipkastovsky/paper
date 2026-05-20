/**
 * Plan 2 production audit — full onboarding-to-dashboard flow.
 *
 * Verifies that the react-query peerDependencies fix (commit 906a9f3) eliminates
 * the "No QueryClient set" crash that previously broke /onboarding/handle and
 * /dashboard by shipping two React contexts via duplicate package copies.
 *
 * Run:
 *   pnpm --filter @paper/web exec playwright test \
 *     --config=playwright.p2-audit.config.ts --reporter=list
 *
 * Screenshots land in tests/e2e/screenshots/p2-prod-*.png.
 */
import { type Page, expect, test } from "@playwright/test";

const PROD = "https://papercrypto.tech";
const _API = "https://api.papercrypto.tech";
const SHOTS = "tests/e2e/screenshots";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

interface ConsoleProblem {
  type: "pageerror" | "console.error";
  text: string;
}

interface FailedRequest {
  method: string;
  url: string;
  status: number;
}

/** Attach console-error + page-error listeners and return accumulator arrays. */
function attachDiagnostics(page: Page): {
  consoleErrors: ConsoleProblem[];
  failedRequests: FailedRequest[];
} {
  const consoleErrors: ConsoleProblem[] = [];
  const failedRequests: FailedRequest[] = [];

  page.on("pageerror", (err) => consoleErrors.push({ type: "pageerror", text: err.message }));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push({ type: "console.error", text: msg.text() });
  });
  page.on("response", (resp) => {
    const url = resp.url();
    const status = resp.status();
    // Only flag failures on our own domains to avoid noise from third-party.
    if (
      status >= 400 &&
      (url.includes("papercrypto.tech") || url.includes("api.papercrypto.tech"))
    ) {
      failedRequests.push({ method: resp.request().method(), url, status });
    }
  });

  return { consoleErrors, failedRequests };
}

/** Wait until bootstrapAuth has populated localStorage (max 20s). */
async function waitForAuth(page: Page, timeout = 20_000) {
  await page.waitForFunction(
    () => !!localStorage.getItem("paper.user") && !!localStorage.getItem("paper.refresh_token"),
    null,
    { timeout },
  );
}

/**
 * Check DOM for any rendered error-boundary text that would indicate a crash.
 * Returns the error text if found, null otherwise.
 */
async function detectErrorBoundary(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const body = document.body?.textContent ?? "";
    // Common React error boundary phrases and our own error boundary copy.
    const patterns = [
      /No QueryClient set/i,
      /Something went wrong/i,
      /minified react error/i,
      /application error/i,
      /unexpected application error/i,
    ];
    for (const re of patterns) {
      if (re.test(body)) {
        // Return the first matching sentence for the report.
        const sentences = body
          .split(/[\n.!?]/)
          .map((s) => s.trim())
          .filter((s) => re.test(s));
        return sentences[0] ?? "error boundary detected";
      }
    }
    return null;
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// The single serial flow (steps share state via page context)
// ──────────────────────────────────────────────────────────────────────────────

test.describe.configure({ mode: "serial" });

// Accumulated diagnostics across the whole session.
let _allConsoleErrors: ConsoleProblem[] = [];
let _allFailedRequests: FailedRequest[] = [];
// The handle claimed during step 3, verified again in step 5.
let claimedHandle = "";

/**
 * STEP 1 — Root → /onboarding/welcome
 *
 * Navigate to https://papercrypto.tech/. Expect redirect to /onboarding/welcome,
 * hero $10,000 numeral + "Get started" CTA visible, zero console errors.
 */
test("Step 1 — Root redirects to /onboarding/welcome; hero + CTA visible; zero console errors", async ({
  page,
}) => {
  const { consoleErrors, failedRequests } = attachDiagnostics(page);
  _allConsoleErrors = consoleErrors;
  _allFailedRequests = failedRequests;

  // Fresh session — no stale localStorage from a previous run.
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {}
  });

  await page.goto(PROD, { waitUntil: "networkidle" });

  // URL must be /onboarding/welcome after the router redirect.
  await expect(page).toHaveURL(/\/onboarding\/welcome/, { timeout: 15_000 });

  // Auth bootstraps in the background; wait for it so subsequent steps work.
  await waitForAuth(page);

  // Hero numeral.
  await expect(page.getByText("$10,000").first()).toBeVisible({ timeout: 10_000 });

  // "Get started" CTA (rendered as a link-button).
  await expect(page.getByRole("link", { name: /get started/i }).first()).toBeVisible();

  // No error boundary.
  const boundary = await detectErrorBoundary(page);
  expect(boundary, `error boundary text: ${boundary}`).toBeNull();

  await page.screenshot({
    path: `${SHOTS}/p2-prod-01-welcome.png`,
    fullPage: true,
  });

  // Attach diagnostics to test info for the report.
  test.info().annotations.push({
    type: "step1-url",
    description: page.url(),
  });
  test.info().annotations.push({
    type: "step1-console-errors",
    description: JSON.stringify(consoleErrors),
  });

  expect(consoleErrors, `Step 1 console errors: ${JSON.stringify(consoleErrors)}`).toEqual([]);
});

/**
 * STEP 2 — Get started → /onboarding/handle
 *
 * Click "Get started". URL transitions to /onboarding/handle.
 * Step indicator shows ≥2 active pips. The @-prefixed input is visible.
 * CRITICAL: No error boundary (previously crashed here with "No QueryClient set").
 */
test("Step 2 — Get started → /onboarding/handle; step indicator active; input visible; NO error boundary", async ({
  page,
}) => {
  // Navigate fresh so the test is independently runnable (serial mode re-uses
  // the same browser profile, but we still need a valid session).
  await page.goto(`${PROD}/onboarding/welcome`, { waitUntil: "networkidle" });
  await waitForAuth(page);

  // Attach diagnostics for this step (may be second set if serial).
  const { consoleErrors, failedRequests: _failedRequests } = attachDiagnostics(page);

  // Click the CTA.
  await page
    .getByRole("link", { name: /get started/i })
    .first()
    .click();

  // URL transition.
  await expect(page).toHaveURL(/\/onboarding\/handle/, { timeout: 15_000 });

  // CRITICAL check: no error boundary.
  const boundary = await detectErrorBoundary(page);
  expect(boundary, `CRITICAL — error boundary on /onboarding/handle: ${boundary}`).toBeNull();

  // Step indicator: at least 2 pips should be "active" (bg-ink vs bg-line).
  // Tailwind classes are present as literal class names in the DOM.
  // We inspect via JS evaluate to see the raw className strings.
  const pipInfo = await page.evaluate(() => {
    const ol = document.querySelector('[aria-label="Onboarding progress"]');
    if (!ol) return { total: 0, classes: [] as string[], activeByClass: 0, activeByBg: 0 };
    const lis = Array.from(ol.querySelectorAll("li"));
    const classes = lis.map((li) => li.className);
    // Count pips whose computed background is darker (active) vs lighter (inactive).
    // bg-ink should be a dark color; bg-line should be lighter.
    const activeByBg = lis.filter((li) => {
      const cs = window.getComputedStyle(li);
      // A pip is "active" if its background is not transparent and has appreciable
      // darkness (bg-ink is typically a dark ink color, bg-line is light grey).
      const rgb = cs.backgroundColor;
      const m = rgb.match(/\d+/g);
      if (!m) return false;
      const [r, g, b] = m.map(Number);
      // Simple luminance check: active (ink) pips are dark.
      const luminance = ((r ?? 0) * 299 + (g ?? 0) * 601 + (b ?? 0) * 114) / 1000;
      return luminance < 100; // dark = active
    }).length;
    // Also check by class name string.
    const activeByClass = lis.filter((li) => li.className.includes("bg-ink")).length;
    return { total: lis.length, classes, activeByClass, activeByBg };
  });

  test.info().annotations.push({
    type: "step2-pip-info",
    description: JSON.stringify(pipInfo, null, 2),
  });

  // At handle step (index 1) we expect 2 active pips (welcome + handle).
  // Accept either class-based or luminance-based count ≥2.
  const activePipCount = Math.max(pipInfo.activeByClass, pipInfo.activeByBg);
  expect(
    activePipCount,
    `Step indicator should have ≥2 active pips (got class=${pipInfo.activeByClass}, bg=${pipInfo.activeByBg}; all classes: ${JSON.stringify(pipInfo.classes)})`,
  ).toBeGreaterThanOrEqual(2);

  // The @-prefixed handle input (rendered by HandleInput).
  // HandleInput renders an input with a "@" prefix label or placeholder.
  const input = page.locator('input[type="text"], input:not([type])').first();
  await expect(input).toBeVisible({ timeout: 8_000 });

  await page.screenshot({
    path: `${SHOTS}/p2-prod-02-handle.png`,
    fullPage: true,
  });

  test.info().annotations.push({
    type: "step2-url",
    description: page.url(),
  });
  test.info().annotations.push({
    type: "step2-console-errors",
    description: JSON.stringify(consoleErrors),
  });
  test.info().annotations.push({
    type: "step2-active-pips",
    description: String(activePipCount),
  });
});

/**
 * STEP 3 — Type handle + claim → /onboarding/balance
 *
 * Type a unique handle, wait for "available ✓", click "Claim handle".
 * Verify the PATCH /v1/me returns 200. URL becomes /onboarding/balance.
 */
test("Step 3 — Type unique handle, await available, claim; PATCH 200; URL → /onboarding/balance", async ({
  page,
}) => {
  // Generate a handle that fits the server's allowed format (alphanumeric + underscore,
  // 3-20 chars). Use Date.now base-36 for uniqueness, prefix with "pa_".
  const suffix = Date.now().toString(36);
  const raw = `pa_${suffix}`;
  claimedHandle = raw.slice(0, 20).toLowerCase();

  await page.goto(`${PROD}/onboarding/handle`, { waitUntil: "networkidle" });
  await waitForAuth(page);

  // Track the PATCH /v1/me call.
  let patchStatus: number | null = null;
  page.on("response", (resp) => {
    if (resp.request().method() === "PATCH" && resp.url().includes("/v1/me")) {
      patchStatus = resp.status();
    }
  });

  const input = page.locator('input[type="text"], input:not([type])').first();
  await expect(input).toBeVisible({ timeout: 8_000 });
  await input.fill(claimedHandle);

  // Wait up to 5s for the availability check to resolve with "available ✓".
  // HandleInput renders an indicator; we look for any text containing "available".
  await expect(
    page
      .locator("*")
      .filter({ hasText: /available/i })
      .first(),
  ).toBeVisible({ timeout: 8_000 });

  // Click "Claim handle".
  await page.getByRole("button", { name: /claim handle/i }).click();

  // URL transitions to /onboarding/balance.
  await expect(page).toHaveURL(/\/onboarding\/balance/, { timeout: 20_000 });

  // PATCH must have returned 200.
  expect(patchStatus, `PATCH /v1/me returned ${patchStatus} (expected 200)`).toBe(200);

  // No error boundary.
  const boundary = await detectErrorBoundary(page);
  expect(boundary, `error boundary on /onboarding/balance: ${boundary}`).toBeNull();

  await page.screenshot({
    path: `${SHOTS}/p2-prod-03-balance.png`,
    fullPage: true,
  });

  test.info().annotations.push({
    type: "step3-handle",
    description: claimedHandle,
  });
  test.info().annotations.push({
    type: "step3-patch-status",
    description: String(patchStatus),
  });
  test.info().annotations.push({
    type: "step3-url",
    description: page.url(),
  });
});

/**
 * STEP 4 — Let's go → /onboarding/lesson
 *
 * Click "Let's go". URL transitions. "Bite-sized lessons" copy visible.
 */
test("Step 4 — Let's go → /onboarding/lesson; bite-sized lessons copy visible", async ({
  page,
}) => {
  await page.goto(`${PROD}/onboarding/balance`, { waitUntil: "networkidle" });
  await waitForAuth(page);

  await page
    .getByRole("link", { name: /let'?s go/i })
    .first()
    .click();

  await expect(page).toHaveURL(/\/onboarding\/lesson/, { timeout: 15_000 });

  // "Bite-sized lessons" heading copy.
  await expect(page.getByText(/bite-?sized lessons/i).first()).toBeVisible({ timeout: 8_000 });

  // No error boundary.
  const boundary = await detectErrorBoundary(page);
  expect(boundary, `error boundary on /onboarding/lesson: ${boundary}`).toBeNull();

  await page.screenshot({
    path: `${SHOTS}/p2-prod-04-lesson.png`,
    fullPage: true,
  });

  test.info().annotations.push({
    type: "step4-url",
    description: page.url(),
  });
});

/**
 * STEP 5 — Skip → /dashboard
 *
 * Click "Skip to my dashboard". URL transitions.
 * CRITICAL: No error boundary (previously crashed here with "No QueryClient set").
 * Verify:
 *   - HeroPortfolioCard shows @<handle> + $10,000 numeral.
 *   - AssetList renders ≥6 of the 12 asset IDs, each with a price containing "$".
 *   - TopMoversStrip is visible with "top movers today" eyebrow + ≥1 chip.
 */
test("Step 5 — Skip → /dashboard; HeroPortfolioCard + AssetList + TopMoversStrip all render; NO error boundary", async ({
  page,
}) => {
  // Attach diagnostics for this step.
  const { consoleErrors, failedRequests: _failedRequests } = attachDiagnostics(page);

  // Run through handle → balance → lesson → dashboard in this page session
  // so the same account that claims the handle ends up on /dashboard.
  // This ensures @<handle> is visible in HeroPortfolioCard.
  await page.goto(`${PROD}/onboarding/handle`, { waitUntil: "networkidle" });
  await waitForAuth(page);

  // Claim a fresh handle for this session.
  const suffix5 = Date.now().toString(36);
  const step5Handle = `s5_${suffix5}`.slice(0, 20).toLowerCase();
  const input = page.locator('input[type="text"], input:not([type])').first();
  await expect(input).toBeVisible({ timeout: 8_000 });
  await input.fill(step5Handle);
  await expect(
    page
      .locator("*")
      .filter({ hasText: /available/i })
      .first(),
  ).toBeVisible({ timeout: 8_000 });
  await page.getByRole("button", { name: /claim handle/i }).click();

  // Balance page.
  await expect(page).toHaveURL(/\/onboarding\/balance/, { timeout: 20_000 });
  await page
    .getByRole("link", { name: /let'?s go/i })
    .first()
    .click();

  // Lesson page.
  await expect(page).toHaveURL(/\/onboarding\/lesson/, { timeout: 15_000 });
  await page
    .getByRole("link", { name: /skip to my dashboard/i })
    .first()
    .click();

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

  // CRITICAL: No error boundary.
  const boundary = await detectErrorBoundary(page);
  expect(boundary, `CRITICAL — error boundary on /dashboard: ${boundary}`).toBeNull();

  // Give queries up to 15s to populate (react-query fetches from the API).
  // HeroPortfolioCard: @<handle> and $10,000 numeral.
  await expect(page.getByText(new RegExp(`@${step5Handle}`, "i")).first()).toBeVisible({
    timeout: 15_000,
  });

  test.info().annotations.push({
    type: "step5-handle",
    description: step5Handle,
  });

  // $10,000 (or close — portfolio starts at exactly $10,000).
  await expect(page.getByText(/\$10[,.]?000/).first()).toBeVisible({
    timeout: 10_000,
  });

  // AssetList: ≥6 of the 12 canonical asset IDs appear with a "$" price.
  const ASSET_IDS = [
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

  // Wait until the AssetList has fully hydrated — specifically, until at least
  // one <li> contains a ticker AND a decimal price.
  // formatUsd() returns plain numbers like "80,817.02" (no $ sign — it's
  // Intl.NumberFormat without style:currency). So we match \d+,?\d+\.\d+ patterns.
  await page.waitForFunction(
    () => {
      const lis = Array.from(document.querySelectorAll("li"));
      return lis.some((li) => {
        const text = li.textContent ?? "";
        // Must contain a decimal number price (e.g. "80,817.02") and an uppercase ticker.
        return /\d[\d,]*\.\d{2}/.test(text) && /[A-Z]{2,4}/.test(text);
      });
    },
    null,
    { timeout: 25_000 },
  );

  const assetResults = await page.evaluate((ids) => {
    // Gather all <li> elements that represent asset rows.
    // formatUsd returns plain "80,817.02" (no $ prefix) so match that pattern.
    const lis = Array.from(document.querySelectorAll<HTMLLIElement>("li"));
    return ids.map((id) => {
      const li = lis.find((el) => {
        const text = el.textContent ?? "";
        return text.includes(id) && /\d[\d,]*\.\d{2}/.test(text);
      });
      return {
        id,
        found: !!li,
        hasPrice: li ? /\d[\d,]*\.\d{2}/.test(li.textContent ?? "") : false,
        liText: li ? (li.textContent ?? "").slice(0, 80) : null,
      };
    });
  }, ASSET_IDS);

  test.info().annotations.push({
    type: "step5-asset-results",
    description: JSON.stringify(assetResults, null, 2),
  });

  const assetsWithPrice = assetResults.filter((r) => r.found && r.hasPrice);
  expect(
    assetsWithPrice.length,
    `Expected ≥6 assets with prices, got ${assetsWithPrice.length}: ${JSON.stringify(assetResults)}`,
  ).toBeGreaterThanOrEqual(6);

  // TopMoversStrip: "top movers today" eyebrow text + at least one chip.
  await expect(page.getByText(/top movers today/i).first()).toBeVisible({ timeout: 10_000 });

  // A chip is an <li> inside the strip — each mover is a flex column with the
  // asset ID and a percentage. Assert ≥1 such element exists.
  const moverChips = page.locator('[aria-label="Top movers today"] li');
  await expect(moverChips.first()).toBeVisible({ timeout: 10_000 });
  const chipCount = await moverChips.count();
  expect(chipCount, "TopMoversStrip should have ≥1 mover chip").toBeGreaterThanOrEqual(1);

  await page.screenshot({
    path: `${SHOTS}/p2-prod-05-dashboard.png`,
    fullPage: true,
  });

  test.info().annotations.push({
    type: "step5-url",
    description: page.url(),
  });
  test.info().annotations.push({
    type: "step5-console-errors",
    description: JSON.stringify(consoleErrors),
  });
  test.info().annotations.push({
    type: "step5-chip-count",
    description: String(chipCount),
  });
  test.info().annotations.push({
    type: "step5-assets-with-price-count",
    description: String(assetsWithPrice.length),
  });
});

/**
 * STEP 6 — Network sanity
 *
 * Run the full onboarding-to-dashboard flow in a single browser session,
 * accumulating ALL console errors and ALL 4xx/5xx responses from our domains.
 * Expected count for both: zero.
 * Specifically checks: no "No QueryClient set", no CORS errors, no 4xx/5xx.
 */
test("Step 6 — Network sanity: zero console errors + zero 4xx/5xx across full flow", async ({
  page,
}) => {
  const consoleErrors: ConsoleProblem[] = [];
  const failedRequests: FailedRequest[] = [];

  page.on("pageerror", (err) => consoleErrors.push({ type: "pageerror", text: err.message }));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push({ type: "console.error", text: msg.text() });
  });
  page.on("response", (resp) => {
    const url = resp.url();
    const status = resp.status();
    if (
      status >= 400 &&
      (url.includes("papercrypto.tech") || url.includes("api.papercrypto.tech"))
    ) {
      failedRequests.push({ method: resp.request().method(), url, status });
    }
  });

  // Fresh session.
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {}
  });

  // ── Welcome ──────────────────────────────────────────────────────────────
  await page.goto(PROD, { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/onboarding\/welcome/, { timeout: 15_000 });
  await waitForAuth(page);

  // ── Handle ───────────────────────────────────────────────────────────────
  await page
    .getByRole("link", { name: /get started/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/onboarding\/handle/, { timeout: 15_000 });

  // Check for "No QueryClient set" crash immediately after navigation.
  const handleBoundary = await detectErrorBoundary(page);
  expect(
    handleBoundary,
    `CRITICAL — "No QueryClient set" or error boundary on /onboarding/handle: ${handleBoundary}`,
  ).toBeNull();

  // Type a unique handle.
  const suffix2 = (Date.now() + 1).toString(36);
  const sanityHandle = `sa_${suffix2}`.slice(0, 20).toLowerCase();
  const input = page.locator('input[type="text"], input:not([type])').first();
  await expect(input).toBeVisible({ timeout: 8_000 });
  await input.fill(sanityHandle);
  await expect(
    page
      .locator("*")
      .filter({ hasText: /available/i })
      .first(),
  ).toBeVisible({ timeout: 8_000 });
  await page.getByRole("button", { name: /claim handle/i }).click();

  // ── Balance ───────────────────────────────────────────────────────────────
  await expect(page).toHaveURL(/\/onboarding\/balance/, { timeout: 20_000 });

  await page
    .getByRole("link", { name: /let'?s go/i })
    .first()
    .click();

  // ── Lesson ────────────────────────────────────────────────────────────────
  await expect(page).toHaveURL(/\/onboarding\/lesson/, { timeout: 15_000 });

  await page
    .getByRole("link", { name: /skip to my dashboard/i })
    .first()
    .click();

  // ── Dashboard ─────────────────────────────────────────────────────────────
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

  // CRITICAL: No error boundary.
  const dashboardBoundary = await detectErrorBoundary(page);
  expect(
    dashboardBoundary,
    `CRITICAL — error boundary on /dashboard: ${dashboardBoundary}`,
  ).toBeNull();

  // Wait for queries to settle.
  await page.waitForTimeout(3_000);

  await page.screenshot({
    path: `${SHOTS}/p2-prod-06-network-sanity.png`,
    fullPage: true,
  });

  // ── Final assertions ──────────────────────────────────────────────────────
  test.info().annotations.push({
    type: "step6-console-errors",
    description: JSON.stringify(consoleErrors, null, 2),
  });
  test.info().annotations.push({
    type: "step6-failed-requests",
    description: JSON.stringify(failedRequests, null, 2),
  });

  // Check specifically for the regression signature.
  const queryClientErrors = consoleErrors.filter((e) => /no queryClient set/i.test(e.text));
  expect(
    queryClientErrors,
    `REGRESSION: "No QueryClient set" errors found: ${JSON.stringify(queryClientErrors)}`,
  ).toEqual([]);

  const corsErrors = consoleErrors.filter((e) => /cors/i.test(e.text));
  expect(corsErrors, `CORS errors found: ${JSON.stringify(corsErrors)}`).toEqual([]);

  expect(
    consoleErrors,
    `Console errors (expected zero): ${JSON.stringify(consoleErrors, null, 2)}`,
  ).toEqual([]);

  expect(
    failedRequests,
    `4xx/5xx requests (expected zero): ${JSON.stringify(failedRequests, null, 2)}`,
  ).toEqual([]);
});
