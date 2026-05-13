import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminBypassClient, anonClient, getHarnessUsers, signInAs } from "./clients";

/**
 * Hotfix verification for 20260513000000_harden_transfer_admin_functions.sql.
 *
 * Pre-hotfix, `transfer_admin_role` and `transfer_coordinator_and_delete`
 * were SECURITY DEFINER functions callable by anon and authenticated
 * roles. Their bodies validated the *target* arguments (the from-admin's
 * role, the target coordinator's role) but never verified that
 * `auth.uid()` was the supposed-source admin. Any caller could invoke
 * `transfer_admin_role(<some_admin_uuid>, <some_coord_uuid>)` and flip
 * the admin role to a coordinator of their choosing.
 *
 * The hotfix inserts two checks at the top of each function body:
 *   1. `auth.uid() = <admin-arg>` — caller must be the claimed admin
 *   2. `is_admin()`               — caller must currently hold the admin role
 *
 * Both raise SQLSTATE '42501' (insufficient_privilege).
 *
 * Phase 2 will additionally REVOKE these functions' EXECUTE grant from
 * anon as defence-in-depth; the assertive check below is the
 * authoritative gate regardless of grant state.
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

// ─── transfer_admin_role ──────────────────────────────────────────

describe("transfer_admin_role: caller-identity check", () => {
  beforeAll(async () => {
    // Ensure the harness admin is in a clean 'admin' state at the
    // start of this describe block. The positive-case test at the
    // bottom flips it to coordinator + back, but if a prior failed
    // run left state dirty, normalize it here.
    const admin = adminBypassClient();
    const users = getHarnessUsers();
    await admin.from("profiles").update({ role: "admin" } as never).eq("id", users.admin.id);
    await admin.from("profiles").update({ role: "coordinator" } as never).eq("id", users.coordinator.id);
  });

  afterAll(async () => {
    // Defence-in-depth reset: leave the harness admin and coordinator
    // in their expected roles for subsequent test files.
    const admin = adminBypassClient();
    const users = getHarnessUsers();
    await admin.from("profiles").update({ role: "admin" } as never).eq("id", users.admin.id);
    await admin.from("profiles").update({ role: "coordinator" } as never).eq("id", users.coordinator.id);
  });

  it("rejects anon caller (auth.uid() IS NULL)", async () => {
    const users = getHarnessUsers();
    const client = anonClient();
    const { error } = await (client.rpc as never)("transfer_admin_role", {
      from_admin_id: users.admin.id,
      to_coordinator_id: users.coordinator.id,
    });
    expectForbidden(error, "anon");
  });

  it("rejects volunteer caller passing the admin's UID (auth.uid() <> from_admin_id)", async () => {
    // This is the *exact* exploit shape the hotfix closes: a
    // non-admin authenticated user passes the real admin's UUID
    // hoping the function won't notice they're not that user.
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const { error } = await (client.rpc as never)("transfer_admin_role", {
      from_admin_id: users.admin.id,
      to_coordinator_id: users.coordinator.id,
    });
    expectForbidden(error, "volunteer-as-admin");
  });

  it("rejects volunteer caller passing their own UID (auth.uid() = from_admin_id, but not admin)", async () => {
    // Even if the caller correctly identifies themselves, the
    // is_admin() check must still gate the operation.
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const { error } = await (client.rpc as never)("transfer_admin_role", {
      from_admin_id: users.volunteer.id,
      to_coordinator_id: users.coordinator.id,
    });
    expectForbidden(error, "volunteer-as-self");
  });

  it("rejects coordinator caller passing their own UID (authenticated, but not admin)", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("coordinator");
    const { error } = await (client.rpc as never)("transfer_admin_role", {
      from_admin_id: users.coordinator.id,
      to_coordinator_id: users.coordinator.id,
    });
    expectForbidden(error, "coordinator-as-self");
  });

  it("admin caller passing their own UID succeeds (positive case)", async () => {
    // Confirms the hotfix didn't break the legitimate path. The
    // harness admin transfers admin to the harness coordinator;
    // afterAll flips both back.
    const users = getHarnessUsers();
    const client = await signInAs("admin");
    const { error } = await (client.rpc as never)("transfer_admin_role", {
      from_admin_id: users.admin.id,
      to_coordinator_id: users.coordinator.id,
    });
    expect(error).toBeNull();

    // Verify the swap actually happened.
    const admin = adminBypassClient();
    const { data: rows } = await admin
      .from("profiles")
      .select("id, role")
      .in("id", [users.admin.id, users.coordinator.id]);
    const byId = new Map((rows ?? []).map((r: { id: string; role: string }) => [r.id, r.role]));
    expect(byId.get(users.admin.id)).toBe("coordinator");
    expect(byId.get(users.coordinator.id)).toBe("admin");
  });
});

// ─── transfer_coordinator_and_delete ──────────────────────────────

describe("transfer_coordinator_and_delete: caller-identity check", () => {
  // Negative cases only — the positive path deletes the harness
  // coordinator, and reconstituting it (with its department link
  // and seeded volunteer FKs) is more state work than the test is
  // worth. The negative path is the security check we're proving.

  it("rejects anon caller (auth.uid() IS NULL)", async () => {
    const users = getHarnessUsers();
    const client = anonClient();
    const { error } = await (client.rpc as never)("transfer_coordinator_and_delete", {
      p_coordinator_id: users.coordinator.id,
      p_admin_id: users.admin.id,
    });
    expectForbidden(error, "anon");
  });

  it("rejects volunteer caller passing the admin's UID (auth.uid() <> p_admin_id)", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const { error } = await (client.rpc as never)("transfer_coordinator_and_delete", {
      p_coordinator_id: users.coordinator.id,
      p_admin_id: users.admin.id,
    });
    expectForbidden(error, "volunteer-as-admin");
  });

  it("rejects coordinator caller passing their own UID (authenticated, but not admin)", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("coordinator");
    const { error } = await (client.rpc as never)("transfer_coordinator_and_delete", {
      p_coordinator_id: users.coordinator.id,
      p_admin_id: users.coordinator.id,
    });
    expectForbidden(error, "coordinator-as-self");
  });

  it("rejects volunteer caller passing their own UID (auth.uid() = p_admin_id, but not admin)", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const { error } = await (client.rpc as never)("transfer_coordinator_and_delete", {
      p_coordinator_id: users.coordinator.id,
      p_admin_id: users.volunteer.id,
    });
    expectForbidden(error, "volunteer-as-self");
  });

  it("verifies the 42501 propagates through the function's EXCEPTION block (not swallowed into the success-envelope)", async () => {
    // The pre-existing function wraps OTHERS exceptions into a
    // {success: false, error: ...} jsonb envelope. The hotfix adds
    // a WHEN SQLSTATE '42501' THEN RAISE branch so caller-identity
    // failures surface as real errors (client sees 403) rather than
    // a 200 with success:false. This test pins that contract.
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const { data, error } = await (client.rpc as never)("transfer_coordinator_and_delete", {
      p_coordinator_id: users.coordinator.id,
      p_admin_id: users.admin.id,
    });
    // Must be a real error, NOT a {success:false} envelope.
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });
});
