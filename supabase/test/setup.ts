/**
 * RLS test harness — global setup.
 *
 * Runs once per Vitest invocation (before any test file). Brings the
 * local Supabase stack up if it isn't already, resets the database to
 * a clean migrated state, applies fixtures.sql, and seeds test users
 * (one volunteer, one coordinator, one admin) via the auth admin API.
 *
 * Capture pattern: API URL and the local-stack keys are read from
 * `supabase status -o json` and injected into process.env so test
 * files can import them via supabase/test/clients.ts. The keys are
 * deterministic for the local stack — never reuse production keys
 * here.
 *
 * Idempotency: if the stack is already running, we reuse it. We
 * always run `supabase db reset` to start every Vitest run from a
 * known schema state. Local dev iteration is therefore: keep the
 * stack up, accept ~10s reset cost between runs.
 *
 * NOT a per-test reset. Per the harness convention (see CONTRIBUTING.md):
 *   - global setup: one-time per Vitest invocation
 *   - per-file: beforeAll resets DB + reseeds; afterAll resets again
 *   - per-test: each test creates its own rows, afterEach cleans them
 *     up in FK order
 *
 * Required local prerequisites (CONTRIBUTING.md documents these):
 *   - Docker Desktop running
 *   - supabase CLI installed and the project linked (or unlinked,
 *     either works for local stack — we don't talk to the cloud)
 */

import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { createClient, type User } from "@supabase/supabase-js";

export interface HarnessUsers {
  volunteer: { id: string; email: string };
  volunteer2: { id: string; email: string };
  coordinator: { id: string; email: string };
  admin: { id: string; email: string };
}

export const TEST_DEPARTMENT_ID = "00000000-0000-0000-0000-000000000200";
export const TEST_LOCATION_ID = "00000000-0000-0000-0000-000000000100";
export const TEST_PASSWORD = "harness-test-password-aB1!";

function run(cmd: string, opts: { silent?: boolean } = {}) {
  return execSync(cmd, {
    stdio: opts.silent ? "pipe" : "inherit",
    cwd: resolve(__dirname, "../.."),
    encoding: "utf-8",
  });
}

function ensureStackRunning(): void {
  try {
    run("supabase status", { silent: true });
    console.log("[harness] Supabase local stack already running.");
  } catch {
    console.log("[harness] Starting Supabase local stack (first run takes 2–5 min)...");
    run("supabase start");
  }
}

function readStackStatus(): { apiUrl: string; anonKey: string; serviceRoleKey: string } {
  // `supabase status -o json` emits a JSON object with API_URL, ANON_KEY,
  // SERVICE_ROLE_KEY (and others). Stable across CLI 1.x and 2.x.
  const json = run("supabase status -o json", { silent: true });
  const status = JSON.parse(json) as Record<string, string>;
  return {
    apiUrl: status.API_URL,
    anonKey: status.ANON_KEY,
    serviceRoleKey: status.SERVICE_ROLE_KEY,
  };
}

async function createTestUser(
  admin: ReturnType<typeof createClient>,
  email: string,
  role: "volunteer" | "coordinator" | "admin",
  fullName: string,
): Promise<User> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName, role },
  });
  if (error || !data.user) {
    throw new Error(`Failed to create test user ${email}: ${error?.message ?? "no user"}`);
  }
  // Insert profile row. handle_new_user trigger doesn't exist in this
  // schema (verified at proposal time), so we create profiles explicitly.
  const { error: profileError } = await admin
    .from("profiles")
    // Boundary cast — the harness drives tables that the type generator
    // covers but with admin-only paths. eslint.config.js documents this.
    .insert({
      id: data.user.id,
      email,
      full_name: fullName,
      role,
      is_active: true,
      onboarding_complete: true,
      tos_accepted_at: new Date().toISOString(),
      // Username: derive from email local part to keep unique
      username: email.split("@")[0],
    } as never);
  if (profileError) {
    throw new Error(`Failed to create profile for ${email}: ${profileError.message}`);
  }
  return data.user;
}

/**
 * Vitest globalSetup hook. Vitest calls this once per invocation
 * before any test file runs.
 */
export async function setup(): Promise<void> {
  console.log("[harness] Setup starting...");

  // 1. Ensure the local stack is up.
  ensureStackRunning();

  // 2. Reset DB to a clean migrated state. --no-seed because Supabase's
  //    default seed.sql isn't part of this harness; we apply our own
  //    fixtures.sql below.
  console.log("[harness] Resetting database + applying migrations...");
  run("supabase db reset --no-seed");

  // 3. Apply non-user fixtures (department, location, cron suppression).
  console.log("[harness] Applying fixtures.sql...");
  run("supabase db psql --file supabase/test/fixtures.sql", { silent: true });

  // 4. Read stack URLs/keys and stash for tests.
  const { apiUrl, anonKey, serviceRoleKey } = readStackStatus();
  process.env.HARNESS_SUPABASE_URL = apiUrl;
  process.env.HARNESS_ANON_KEY = anonKey;
  process.env.HARNESS_SERVICE_ROLE_KEY = serviceRoleKey;

  // 5. Seed test users. We use a fixed-suffix email pattern ("@harness.local")
  //    so they're distinguishable from any other accidentally-present accounts.
  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const volunteer = await createTestUser(admin, "volunteer1@harness.local", "volunteer", "Test Volunteer One");
  const volunteer2 = await createTestUser(admin, "volunteer2@harness.local", "volunteer", "Test Volunteer Two");
  const coordinator = await createTestUser(admin, "coordinator@harness.local", "coordinator", "Test Coordinator");
  const adminUser = await createTestUser(admin, "admin@harness.local", "admin", "Test Admin");

  // 6. Link coordinator to the test department.
  const { error: coordLinkError } = await admin
    .from("department_coordinators")
    .insert({
      department_id: TEST_DEPARTMENT_ID,
      coordinator_id: coordinator.id,
    } as never);
  if (coordLinkError) {
    throw new Error(`Failed to link coordinator to department: ${coordLinkError.message}`);
  }

  // 7. Stash user IDs for tests via JSON env (process.env can't carry objects).
  const users: HarnessUsers = {
    volunteer: { id: volunteer.id, email: volunteer.email! },
    volunteer2: { id: volunteer2.id, email: volunteer2.email! },
    coordinator: { id: coordinator.id, email: coordinator.email! },
    admin: { id: adminUser.id, email: adminUser.email! },
  };
  process.env.HARNESS_USERS_JSON = JSON.stringify(users);

  console.log("[harness] Setup complete. Users created:");
  console.log("  volunteer  ", users.volunteer.id);
  console.log("  volunteer2 ", users.volunteer2.id);
  console.log("  coordinator", users.coordinator.id);
  console.log("  admin      ", users.admin.id);
}

/**
 * Vitest globalTeardown hook. Vitest calls this once per invocation
 * after all test files complete. We deliberately do NOT stop the
 * stack here — local dev wants to keep it running for repeated test
 * runs, and CI runners are ephemeral so the stack dies with the
 * runner anyway. The next invocation's setup will reset DB state.
 */
export async function teardown(): Promise<void> {
  console.log("[harness] Teardown — leaving stack running for next invocation.");
}
