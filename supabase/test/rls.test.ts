import { describe, it, expect } from "vitest";
import { signInAs, anonClient, getHarnessUsers } from "./clients";

/**
 * RLS harness — pedagogical tests.
 *
 * These two tests exist to prove the harness works end-to-end (real
 * Supabase stack, real RLS enforcement) and to lock down the patterns
 * future tests will follow:
 *
 *   1. signInAs(role) → per-role authenticated client
 *   2. anonClient() → unauthenticated client
 *   3. assertions on RLS denial behavior — Supabase typically returns
 *      empty result sets (not errors) when RLS denies SELECT, because
 *      RLS is a row filter applied transparently
 *
 * The 12 feature-coverage tests for the document-request system live
 * in PR 1 (#151's §8.0). Do NOT add feature tests to this file — keep
 * pedagogical tests minimal so the harness's correctness is obvious.
 */

describe("RLS harness — pedagogical", () => {
  it("volunteer cannot read another volunteer's profile", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");

    // Try to read volunteer2's profile by id. The volunteer1's policies
    // ('profiles: own read', 'profiles: volunteer read admins and dept
    // coordinators') don't permit this. Expect zero rows.
    const { data, error } = await client
      .from("profiles")
      .select("id, email, full_name")
      .eq("id", users.volunteer2.id);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("anonymous user cannot SELECT from profiles", async () => {
    const client = anonClient();

    // Profiles RLS requires authenticated role for every SELECT policy
    // (admin, coordinator-of-dept-volunteer, own, volunteer-reads-admins).
    // Anon falls through every policy and gets zero rows.
    const { data, error } = await client.from("profiles").select("id");

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
