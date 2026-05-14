import { describe, expect, it } from "vitest";
import { anonClient, getHarnessUsers, signInAs } from "./clients";

/**
 * Phase 2 verification for the score_shifts_for_volunteer caller-identity
 * check (added in 20260513120000_security_definer_lockdown.sql).
 *
 * Pre-fix: any authenticated user could pass any volunteer's UUID and
 * rank that volunteer's recommended shifts. Not a confidentiality leak
 * (the function returns shift metadata, scored against a volunteer's
 * history) but the API shape was wrong — "score X's shifts" is a
 * self-scoped operation unless the caller is a coordinator/admin.
 *
 * Post-fix:
 *   - anon  → 42501
 *   - volunteer passing their OWN UID → succeeds (positive path)
 *   - volunteer passing ANOTHER volunteer's UID → 42501
 *   - coordinator passing any volunteer's UID → succeeds
 *   - admin passing any volunteer's UID → succeeds
 *
 * The function is SECURITY DEFINER + STABLE. The grant tightening
 * (REVOKE FROM anon, GRANT TO authenticated) is enforced separately
 * in the same migration; this test exercises the body-level check
 * which is the authoritative gate.
 */

const FORBIDDEN_CODE = "42501";

const expectForbidden = (error: unknown, hint?: string) => {
  const e = error as { code?: string; message?: string } | null;
  expect(e, `expected forbidden error${hint ? ` (${hint})` : ""}`).not.toBeNull();
  expect(
    e?.code === FORBIDDEN_CODE || /forbidden/i.test(e?.message ?? ""),
    `expected 42501 / "forbidden", got code=${e?.code} msg=${e?.message}`,
  ).toBe(true);
};

describe("score_shifts_for_volunteer: caller-identity check", () => {
  it("rejects anon caller (auth.uid() IS NULL)", async () => {
    // anon caller is doubly gated: (1) the EXECUTE grant has been
    // revoked from anon by SECTION 3 of the migration, and (2) the
    // body's auth.uid() IS NULL check would reject even if the grant
    // were restored. Either error is acceptable as long as the call
    // is rejected.
    const users = getHarnessUsers();
    const client = anonClient();
    const { error } = await (client.rpc as never)("score_shifts_for_volunteer", {
      p_volunteer_id: users.volunteer.id,
      p_max_days: 14,
    });
    expect(error).not.toBeNull();
  });

  it("volunteer passing their own UID succeeds (positive path)", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const { error } = await (client.rpc as never)("score_shifts_for_volunteer", {
      p_volunteer_id: users.volunteer.id,
      p_max_days: 14,
    });
    // No 42501 — function executed. Result set may be empty (harness
    // doesn't seed open shifts by default) but the call itself must
    // succeed.
    expect(error).toBeNull();
  });

  it("volunteer passing ANOTHER volunteer's UID is rejected", async () => {
    // This is the exact API-shape misuse the refactor closes: a
    // volunteer ranks another volunteer's recommended shifts. No
    // legitimate frontend path does this.
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const { error } = await (client.rpc as never)("score_shifts_for_volunteer", {
      p_volunteer_id: users.volunteer2.id,
      p_max_days: 14,
    });
    expectForbidden(error, "volunteer-as-other-volunteer");
  });

  it("coordinator passing a volunteer's UID succeeds", async () => {
    // Coordinator/admin scoring on behalf of a volunteer is a
    // legitimate (if currently unused) use case — preserved by the
    // is_coordinator_or_admin() branch of the check.
    const users = getHarnessUsers();
    const client = await signInAs("coordinator");
    const { error } = await (client.rpc as never)("score_shifts_for_volunteer", {
      p_volunteer_id: users.volunteer.id,
      p_max_days: 14,
    });
    expect(error).toBeNull();
  });

  it("admin passing a volunteer's UID succeeds", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("admin");
    const { error } = await (client.rpc as never)("score_shifts_for_volunteer", {
      p_volunteer_id: users.volunteer.id,
      p_max_days: 14,
    });
    expect(error).toBeNull();
  });
});
