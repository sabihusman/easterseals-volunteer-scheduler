import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInAs, adminBypassClient, getHarnessUsers } from "./clients";

/**
 * Pins the column-lock contract from
 * 20260502000000_lock_admin_only_profile_columns.sql.
 *
 * Background: discovered during the Half B-1 prod-migration
 * investigation — `profiles: own update` had no WITH CHECK clause,
 * so a volunteer could PATCH their own bg_check_status from
 * 'pending' to 'cleared' and bypass the booking-window BG-check
 * gate. The fix is a BEFORE UPDATE trigger
 * (prevent_user_from_changing_admin_columns) that raises 42501 when
 * a non-admin tries to mutate any of the locked columns on their
 * own row.
 *
 * These tests exercise both the negative cases (volunteer cannot
 * write the locked columns) and the positive case (volunteer CAN
 * still update normal self-edit columns like full_name and
 * emergency contact).
 *
 * Per the lesson from PR #173: NO it.skip in this file.
 */

beforeAll(async () => {
  const admin = adminBypassClient();
  const users = getHarnessUsers();
  // Reset the volunteer's bg_check_status so the test starts from a
  // known state.
  await admin.from("profiles").update({
    bg_check_status: "pending",
    is_active: true,
    booking_privileges: true,
    is_minor: false,
    messaging_blocked: false,
  } as never).eq("id", users.volunteer.id);
});

afterAll(async () => {
  const admin = adminBypassClient();
  const users = getHarnessUsers();
  await admin.from("profiles").update({
    bg_check_status: "pending",
    is_active: true,
  } as never).eq("id", users.volunteer.id);
});

const expectRlsRejection = (error: unknown) => {
  const e = error as { code?: string; message?: string } | null;
  expect(e).not.toBeNull();
  expect(
    e?.code === "42501" || /cannot change|cannot be (set|modified)/i.test(e?.message ?? ""),
  ).toBe(true);
};

describe("profiles: column locks on volunteer self-update", () => {
  it("volunteer CANNOT change their own bg_check_status (the security finding)", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const { error } = await client
      .from("profiles")
      .update({ bg_check_status: "cleared" } as never)
      .eq("id", users.volunteer.id);
    expectRlsRejection(error);
  });

  it("volunteer CANNOT change their own is_active", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const { error } = await client
      .from("profiles")
      .update({ is_active: false } as never)
      .eq("id", users.volunteer.id);
    expectRlsRejection(error);
  });

  it("volunteer CANNOT change their own booking_privileges", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const { error } = await client
      .from("profiles")
      .update({ booking_privileges: false } as never)
      .eq("id", users.volunteer.id);
    expectRlsRejection(error);
  });

  it("volunteer CANNOT change their own is_minor (would bypass admin approval queue)", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const { error } = await client
      .from("profiles")
      .update({ is_minor: true } as never)
      .eq("id", users.volunteer.id);
    expectRlsRejection(error);
  });

  it("volunteer CANNOT change their own messaging_blocked", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const { error } = await client
      .from("profiles")
      .update({ messaging_blocked: true } as never)
      .eq("id", users.volunteer.id);
    expectRlsRejection(error);
  });

  it("volunteer CANNOT change derived consistency_score / extended_booking / total_hours / volunteer_points", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const probes = [
      { consistency_score: 100 },
      { extended_booking: true },
      { total_hours: 999 },
      { volunteer_points: 9999 },
    ] as const;
    for (const patch of probes) {
      const { error } = await client
        .from("profiles")
        .update(patch as never)
        .eq("id", users.volunteer.id);
      expectRlsRejection(error);
    }
  });

  it("volunteer CAN still update normal self-edit columns (full_name, phone, emergency contact)", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");
    const newName = `Test Volunteer (${Date.now()})`;
    const { error, data } = await client
      .from("profiles")
      .update({
        full_name: newName,
        phone: "555-0100",
        emergency_contact_name: "Test Contact",
        emergency_contact_phone: "555-0200",
      } as never)
      .eq("id", users.volunteer.id)
      .select("id, full_name");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect((data as Array<{ full_name: string }>)[0].full_name).toBe(newName);
  });

  it("admin CAN change a volunteer's bg_check_status (admin bypass)", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("admin");
    const { error, data } = await client
      .from("profiles")
      .update({ bg_check_status: "cleared" } as never)
      .eq("id", users.volunteer.id)
      .select("id, bg_check_status");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect((data as Array<{ bg_check_status: string }>)[0].bg_check_status).toBe("cleared");
  });
});
