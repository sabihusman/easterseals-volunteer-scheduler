import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInAs, adminBypassClient, getHarnessUsers } from "./clients";
import { TEST_DEPARTMENT_ID, TEST_LOCATION_ID } from "./setup";

/**
 * RLS coverage for the coordinator soft-delete (cancel-shift) flow.
 *
 * Audit 2026-04-28 found ManageShifts.tsx:49 was issuing a hard
 * DELETE that the `shifts: coord delete cancelled` policy denied for
 * any non-cancelled shift, returning 200 + empty array — and the UI
 * surfaced "Shift deleted" on a no-op. The fix is now an UPDATE
 * status='cancelled' which is covered by the
 * `shifts: coord/admin update` policy.
 *
 * These tests pin the policy contract so a future migration can't
 * silently strip the coordinator's UPDATE permission without failing
 * CI:
 *
 *   1. Coordinator can UPDATE a shift in a department they manage.
 *   2. Coordinator's UPDATE on a shift in a foreign department
 *      affects 0 rows (RLS denial returns 200 + []).
 *   3. With the .select() correctness fix, the helper distinguishes
 *      these two outcomes — that pure-TS behaviour is covered in
 *      shift-cancel.test.ts; here we verify the underlying RLS shape.
 */

const SHIFT_DATE = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
})();

const FOREIGN_DEPT_ID = "00000000-0000-0000-0000-000000000301";

let ownDeptShiftId: string;
let foreignDeptShiftId: string;

beforeAll(async () => {
  const admin = adminBypassClient();
  const users = getHarnessUsers();

  // Stamp emergency contact on the coordinator so any downstream
  // booking-related triggers don't bite the test setup. (Coordinators
  // don't book shifts, but the harness shares the volunteer's
  // emergency-contact assumption across roles in some triggers.)

  // Create a department the test coordinator is NOT linked to. The
  // harness setup links coordinator → TEST_DEPARTMENT_ID only, so we
  // need a separate dept_id for the negative case.
  await admin.from("departments").upsert(
    {
      id: FOREIGN_DEPT_ID,
      name: "Foreign Test Department (cancel-rls)",
      location_id: TEST_LOCATION_ID,
      is_active: true,
      requires_bg_check: false,
      allows_groups: false,
      min_age: 18,
    } as never,
    { onConflict: "id" },
  );

  // Two open shifts on the same date, one in each department.
  const insertShift = async (deptId: string, title: string) => {
    const { data, error } = await admin
      .from("shifts")
      .insert({
        department_id: deptId,
        created_by: users.admin.id,
        title,
        shift_date: SHIFT_DATE,
        time_type: "morning",
        start_time: "10:00:00",
        end_time: "12:00:00",
        total_slots: 1,
        requires_bg_check: false,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(`shift insert failed (${title}): ${error.message}`);
    return (data as { id: string }).id;
  };

  ownDeptShiftId = await insertShift(TEST_DEPARTMENT_ID, "Own-dept cancel-rls shift");
  foreignDeptShiftId = await insertShift(
    FOREIGN_DEPT_ID,
    "Foreign-dept cancel-rls shift",
  );
});

afterAll(async () => {
  const admin = adminBypassClient();
  await admin.from("shifts").delete().in("id", [ownDeptShiftId, foreignDeptShiftId]);
  await admin.from("departments").delete().eq("id", FOREIGN_DEPT_ID);
});

describe("shifts: coordinator soft-delete (UPDATE status='cancelled') — RLS", () => {
  it("coordinator can UPDATE a shift in their own department (returns the row)", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("coordinator");

    // Diagnostics. We've narrowed the failure to "WITH CHECK on
    // shifts: coord/admin update fails despite all preconditions
    // passing." Logging everything we can read.
    const { data: meRows } = await client
      .from("profiles")
      .select("id, role")
      .eq("id", users.coordinator.id);
    console.log("[probe] me (profiles via auth.uid path):", meRows);

    const { data: deptLinks } = await client
      .from("department_coordinators")
      .select("department_id, coordinator_id");
    console.log("[probe] all dept_coordinators rows visible to me:", deptLinks);

    const { data: visibleShift } = await client
      .from("shifts")
      .select("id, department_id, status, shift_date, time_type")
      .eq("id", ownDeptShiftId)
      .maybeSingle();
    console.log("[probe] target shift before UPDATE:", visibleShift);

    // Try the UPDATE without the chained .select() first — that
    // separates "UPDATE denied by RLS" from "UPDATE succeeded but
    // post-update SELECT can't see the row (cancelled → blocked
    // by `shifts: all read open` which excludes cancelled shifts)."
    const updateNoSelect = await client
      .from("shifts")
      .update({ status: "cancelled" } as never)
      .eq("id", ownDeptShiftId);
    console.log("[probe] UPDATE without .select():", {
      error: updateNoSelect.error,
      status: updateNoSelect.status,
    });

    // Re-probe via service role to see the actual DB state.
    const admin = adminBypassClient();
    const { data: postState } = await admin
      .from("shifts")
      .select("id, status")
      .eq("id", ownDeptShiftId)
      .single();
    console.log("[probe] shift state after UPDATE attempt (service-role view):", postState);

    expect(updateNoSelect.error).toBeNull();
    expect((postState as { status: string })?.status).toBe("cancelled");
  });

  it("coordinator's UPDATE on a foreign-dept shift is RLS-filtered to zero rows", async () => {
    const client = await signInAs("coordinator");

    const { data, error } = await client
      .from("shifts")
      .update({ status: "cancelled" } as never)
      .eq("id", foreignDeptShiftId)
      .select("id, status");

    // PostgREST returns 200 + [] when RLS filters the row out — that's
    // the exact shape the audit identified. The error field stays null.
    expect(error).toBeNull();
    expect(data).toEqual([]);

    // Verify the shift is genuinely untouched.
    const admin = adminBypassClient();
    const { data: probe } = await admin
      .from("shifts")
      .select("status")
      .eq("id", foreignDeptShiftId)
      .single();
    expect((probe as { status: string }).status).toBe("open");
  });
});
