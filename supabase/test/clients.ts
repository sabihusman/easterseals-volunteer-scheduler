/**
 * Per-role Supabase clients for RLS test files.
 *
 * Each test file imports `signInAs(role)` to get a supabase-js client
 * authenticated as the given test user, or `anonClient()` for an
 * unauthenticated client. Service-role client (`adminBypassClient()`)
 * is exposed for test setup / teardown that needs to bypass RLS to
 * stage rows.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { TEST_PASSWORD, type HarnessUsers } from "./setup";

function readEnv(): { apiUrl: string; anonKey: string; serviceRoleKey: string; users: HarnessUsers } {
  const apiUrl = process.env.HARNESS_SUPABASE_URL;
  const anonKey = process.env.HARNESS_ANON_KEY;
  const serviceRoleKey = process.env.HARNESS_SERVICE_ROLE_KEY;
  const usersJson = process.env.HARNESS_USERS_JSON;
  if (!apiUrl || !anonKey || !serviceRoleKey || !usersJson) {
    throw new Error(
      "RLS harness env not initialized. Run via `bun run test:rls` (which loads vitest.config.rls.ts → globalSetup).",
    );
  }
  return {
    apiUrl,
    anonKey,
    serviceRoleKey,
    users: JSON.parse(usersJson) as HarnessUsers,
  };
}

export function getHarnessUsers(): HarnessUsers {
  return readEnv().users;
}

/**
 * Anonymous (anon-key) client — no signed-in user. Use for testing
 * "unauthenticated user can/can't access X" cases.
 */
export function anonClient(): SupabaseClient {
  const { apiUrl, anonKey } = readEnv();
  return createClient(apiUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Service-role client — bypasses RLS entirely. Only for test setup
 * that needs to stage rows the user under test isn't authorized to
 * create. NEVER use for the assertion path itself; it would defeat
 * the purpose of the test.
 */
export function adminBypassClient(): SupabaseClient {
  const { apiUrl, serviceRoleKey } = readEnv();
  return createClient(apiUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Sign in as one of the seeded test users and return a per-user
 * client. The client carries the user's access_token, so subsequent
 * queries see RLS as that user.
 */
export async function signInAs(
  role: "volunteer" | "volunteer2" | "coordinator" | "admin",
): Promise<SupabaseClient> {
  const { apiUrl, anonKey, users } = readEnv();
  const email = users[role].email;
  const client = createClient(apiUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (error) {
    throw new Error(`signInAs(${role}) failed: ${error.message}`);
  }
  return client;
}

/**
 * Retry a supabase-js storage operation that returns `{ data, error }`
 * when the local storage emulator answers with a transient upstream
 * error.
 *
 * The CI storage-api container intermittently returns HTTP 502
 * ("An invalid response was received from the upstream server") on
 * `upload` / `download` / `createSignedUrl` under load — a container
 * health blip, never a correct response to assert on. This blocked the
 * RLS harness on avatars-bucket and document-request-system tests
 * (CI run #1084).
 *
 * Retry policy:
 *   - Retry only on 5xx (or a thrown network error). A 5xx is by
 *     definition not a legitimate result.
 *   - Return immediately on success OR on any 4xx — a 4xx (e.g. 403
 *     RLS-denied, 404 not-found) is a real result the test wants to
 *     assert on, so it must NOT be retried or swallowed.
 *   - After `attempts` exhausted, return the last result so the
 *     caller's `expect(error).toBeNull()` still fails loudly with the
 *     502 surfaced (a persistent outage is a real failure).
 *
 * Usage:
 *   const { data, error } = await withStorageRetry(() =>
 *     client.storage.from(BUCKET).createSignedUrl(path, 60));
 */
export async function withStorageRetry<T extends { error: unknown }>(
  op: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  let result!: T;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      result = await op();
    } catch (err) {
      // Thrown (network-level) error — treat as transient and retry.
      if (attempt === attempts) throw err;
      await new Promise((r) => setTimeout(r, 250 * attempt));
      continue;
    }
    const status = Number(
      (result.error as { status?: number | string } | null)?.status ?? 0,
    );
    // Success, or a real (sub-500) error the test should assert on.
    if (!result.error || (status > 0 && status < 500)) return result;
    if (attempt < attempts) {
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }
  return result;
}
