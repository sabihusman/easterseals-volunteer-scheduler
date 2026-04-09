import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for browser-driving E2E tests of the volunteer
 * scheduler.
 *
 * Separate from `e2e/playwright.config.ts`, which hits the Supabase
 * REST API directly without a browser. These tests render the real
 * deployed app, log in, and drive the UI through booking / waitlist /
 * confirmation / deletion flows.
 *
 * baseURL source of truth (in priority order):
 *   1. PLAYWRIGHT_BASE_URL — set by CI to the Vercel preview URL on
 *      PR runs and the production URL on main branch runs.
 *   2. VERCEL_PREVIEW_URL — fallback for when CI has the preview URL
 *      under a different name.
 *   3. Hardcoded production URL — for local dev convenience.
 */
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.VERCEL_PREVIEW_URL ||
  "https://easterseals-volunteer-scheduler.vercel.app";

export default defineConfig({
  testDir: ".",
  testIgnore: ["**/fixtures/**", "**/helpers/**"],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Tests mutate shared DB state (shifts, bookings). Running in
  // parallel would cause interference, so keep it serial.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }], ["github"]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Default viewport emulates a typical desktop.
    viewport: { width: 1280, height: 800 },
    // Supabase auth cookies are needed cross-request.
    storageState: undefined,
    // REST calls for setup/verification need the anon key.
    extraHTTPHeaders: {
      apikey: process.env.SUPABASE_ANON_KEY || "",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
