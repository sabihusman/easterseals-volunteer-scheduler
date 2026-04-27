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
