import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";

/**
 * Session / login helpers.
 *
 * We deliberately bypass the login UI (email + password + Cloudflare
 * Turnstile) because Turnstile is non-deterministic for headless
 * browsers — it sometimes auto-passes and sometimes demands an
 * interactive checkbox. That's a manual smoke test, not an E2E
 * candidate.
 *
 * Instead we:
 *   1. Hit Supabase's auth REST endpoint directly with the test
 *      credentials (stored as GitHub Actions secrets — NEVER hardcode).
 *   2. Drop the resulting access_token / refresh_token into the
 *      browser's localStorage under the key Supabase-js expects.
 *   3. Navigate — the auth context rehydrates from localStorage on
 *      first load and the user is signed in.
 *
 * Required env vars (CI provides via GitHub Actions secrets):
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   TEST_VOLUNTEER_EMAIL, TEST_PASSWORD
 *   TEST_COORDINATOR_EMAIL
 *   TEST_ADMIN_EMAIL
 */

export const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://esycmohgumryeqteiwla.supabase.co";
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

export type TestRole = "volunteer" | "coordinator" | "admin";

function emailFor(role: TestRole): string {
  switch (role) {
    case "volunteer":
      return process.env.TEST_VOLUNTEER_EMAIL || "";
    case "coordinator":
      return process.env.TEST_COORDINATOR_EMAIL || "";
    case "admin":
      return process.env.TEST_ADMIN_EMAIL || "";
  }
}

function assertCreds() {
  if (!SUPABASE_ANON_KEY) {
    throw new Error(
      "SUPABASE_ANON_KEY env var is required for E2E tests"
    );
  }
  if (!process.env.TEST_PASSWORD) {
    throw new Error(
      "TEST_PASSWORD env var is required for E2E tests"
    );
  }
}

export interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  token_type: string;
  user: { id: string; email: string };
}

/** Authenticate against Supabase auth REST and return the session. */
export async function signInAsRole(
  request: APIRequestContext,
  role: TestRole
): Promise<SupabaseSession> {
  assertCreds();
  const email = emailFor(role);
  if (!email) {
    throw new Error(`No test email configured for role "${role}"`);
  }
  const res = await request.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
      },
      data: { email, password: process.env.TEST_PASSWORD },
    }
  );
  if (!res.ok()) {
    throw new Error(
      `signIn(${role}) failed: ${res.status()} ${await res.text()}`
    );
  }
  const json = (await res.json()) as SupabaseSession;
  return json;
}

/**
 * Inject a Supabase session into the browser so the app renders as
 * signed-in. Supabase-js persists its session under
 * `sb-<project-ref>-auth-token` in localStorage by default.
 */
export async function primeBrowserAuth(
  context: BrowserContext,
  page: Page,
  session: SupabaseSession
): Promise<void> {
  const projectRef = SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0];
  const storageKey = `sb-${projectRef}-auth-token`;
  // Navigate to the app origin first so localStorage is writable.
  await page.goto("/auth");
  await page.evaluate(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    {
      key: storageKey,
      value: JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        expires_in: session.expires_in,
        token_type: session.token_type,
        user: session.user,
      }),
    }
  );
}

/**
 * Convenience: sign in via REST and land the page on a given route
 * with the session active. Returns the session so tests can use the
 * access_token for REST verification.
 */
export async function loginAndVisit(
  request: APIRequestContext,
  context: BrowserContext,
  page: Page,
  role: TestRole,
  path: string = "/dashboard"
): Promise<SupabaseSession> {
  const session = await signInAsRole(request, role);
  await primeBrowserAuth(context, page, session);
  await page.goto(path);
  // Wait for the auth context to resolve and the header to render.
  await page.waitForLoadState("networkidle");
  return session;
}
