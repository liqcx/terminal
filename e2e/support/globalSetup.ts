/**
 * Warm the dev server once, serially, before the parallel test workers start.
 *
 * Why: Vite optimizes its (large) dependency graph — wagmi + viem + the
 * `@liq/*` SDK pull in ~300 prebundled deps — lazily, on the first page load.
 * Left to the suite, that one-time cost lands on the opening wave of parallel
 * tests and slows them ~3x while modules are (re)bundled and served. The
 * heaviest path (cold onboarding: create account → SIWE → terminal) is
 * normally ~6-8s but stretches to ~20s under that cold
 * window, intermittently blowing its visibility gate. A lockfile change (e.g. a
 * dependency bump) forces a full re-optimize, making the squeeze reproducible.
 *
 * A single boot here forces Vite to finish optimization before any worker runs,
 * so every test sees warm modules. The webServer is already up when globalSetup
 * runs (Playwright starts + awaits it first), so this loads the served app. No
 * Tier-1 mocks are installed (those are per-test fixtures); the static app shell
 * (`app-brand`) renders without a backend, which is all we need to drive the
 * full module graph through Vite's optimizer.
 */
import { chromium, type FullConfig } from "@playwright/test";

export default async function globalSetup(config: FullConfig): Promise<void> {
  const { baseURL } = config.projects[0]?.use ?? {};
  if (!baseURL) return;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(baseURL, { waitUntil: "load", timeout: 120_000 });
    // app-brand renders from the static shell (no wallet/backend needed); once
    // it's visible the app's module graph has executed → optimization is done.
    await page
      .getByTestId("app-brand")
      .waitFor({ state: "visible", timeout: 120_000 });
  } finally {
    await browser.close();
  }
}
