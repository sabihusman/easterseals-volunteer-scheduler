import { defineConfig } from "@playwright/test";

// Standalone Playwright config for the e2e/ folder. Independent of the
// Lovable harness wrapper in the root playwright.config.ts so this can
// run anywhere with `npx playwright test --config e2e/playwright.config.ts`.
//
// These tests hit the live deployed Supabase REST API directly. They do
// not require a running dev server or a browser \u2014 they exercise the
// booking lifecycle at the API + database boundary which is where every
// counter-drift bug we've fixed has lived.

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // Database state is shared across tests
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.SUPABASE_URL || "https://esycmohgumryeqteiwla.supabase.co",
    extraHTTPHeaders: {
      apikey: process.env.SUPABASE_ANON_KEY || "",
    },
  },
});
