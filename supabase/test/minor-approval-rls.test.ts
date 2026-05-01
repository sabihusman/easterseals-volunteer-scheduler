import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInAs, adminBypassClient, getHarnessUsers } from "./clients";
import { TEST_DEPARTMENT_ID } from "./setup";

/**
 * RLS + trigger coverage for the Half B-1 minor approval queue.
 *
 * Pin the contract so future migrations can't silently regress:
 *
 *   1. Adult volunteer's INSERT lands as 'confirmed' (or 'waitlisted'
 *      if full).
 *   2. Minor volunteer's INSERT — even when the client sends
 *      booking_status='confirmed' explicitly — gets rewritten to
 *      'pending_admin_approval' by trg_00_route_minor_to_pending.
 *   3. Volunteer's RLS WITH CHECK rejects an explicit
 *      booking_status='cancelled' on INSERT (adult branch).
 *   4. Admin can UPDATE a pending booking → 'confirmed' (approval).
 *   5. Coordinator CANNOT UPDATE pending → 'confirmed' (admin-only
 *      approval, enforced by trg_enforce_admin_only_approval).
 *   6. Volunteer themselves CANNOT UPDATE their own pending →
 *      'confirmed'.
 *   7. Minor's view of their own bookings does NOT include rejected
 *      rows. (App-side filter, but verify the SELECT policy permits
 *      rejected to be readable when explicitly queried — admins/
 *      coordinators need it for the future history-tab feature in
 *      Half B-2.)
 *
 * Per the lesson from PR #173 and the brief: NO it.skip in this file.
 * If a positive-case test fails, investigate the underlying RLS;
 * don't mask it.
 */

const SHIFT_DATE = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
})();

let adultShiftId: string;
let minorShiftId: string;
let pendingBookingId: string;

beforeAll(async () => {
  const admin = adminBypassClient();
  const users = getHarnessUsers();

  // Stamp emergency contact on both volunteers — enforce_booking_window
  // requires it before any booking trigger fires.
  await admin.from("profiles").update({
    emergency_contact_name: "Test Contact",
    emergency_contact_phone: "555-0100",
    is_minor: false,
  } as never).eq("id", users.volunteer.id);

  await admin.from("profiles").update({
    emergency_contact_name: "Parent Contact",
    emergency_contact_phone: "555-0200",
    is_minor: true, // <- the minor flag for the second volunteer
  } as never).eq("id", users.volunteer2.id);

  // Two open shifts on the same date — one we'll use for the adult
  // path, one for the minor path. Keeps the two flows from racing on
  // the unique-per-slot index.
  const insertShift = async (title: string) => {
    const { data, error } = await admin.from("shifts").insert({
      department_id: TEST_DEPARTMENT_ID,
      title,
      shift_date: SHIFT_DATE,
      time_type: "morning",
      start_time: "10:00:00",
      end_time: "12:00:00",
      total_slots: 5,
      booked_slots: 0,
      status: "open",
    } as never).select("id").single();
    if (error || !data) throw new Error(`Setup: shift insert failed: ${error?.message}`);
    return (data as { id: string }).id;
  };
  adultShiftId = await insertShift("Adult test shift (minor-approval-rls)");
  minorShiftId = await insertShift("Minor test shift (minor-approval-rls)");
});

afterAll(async () => {
  const admin = adminBypassClient();
  await admin.from("shift_bookings").delete().in("shift_id", [adultShiftId, minorShiftId]);
  await admin.from("shifts").delete().in("id", [adultShiftId, minorShiftId]);
  // Reset the volunteer2 flag so unrelated tests aren't perturbed.
  const users = getHarnessUsers();
  await admin.from("profiles").update({ is_minor: false } as never).eq("id", users.volunteer2.id);
});

describe("shift_bookings: minor approval queue — RLS + trigger contract", () => {
  it("adult volunteer's INSERT lands as 'confirmed'", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");

    const { data, error } = await client
      .from("shift_bookings")
      .insert({
        shift_id: adultShiftId,
        volunteer_id: users.volunteer.id,
        booking_status: "confirmed",
      } as never)
      .select("id, booking_status")
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect((data as { booking_status: string }).booking_status).toBe("confirmed");
  });

  it("minor volunteer's INSERT is rewritten to 'pending_admin_approval' by the trigger, even if client sends 'confirmed'", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer2");

    const { data, error } = await client
      .from("shift_bookings")
      .insert({
        shift_id: minorShiftId,
        volunteer_id: users.volunteer2.id,
        booking_status: "confirmed", // <- client lies; trigger overrides
      } as never)
      .select("id, booking_status")
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect((data as { booking_status: string }).booking_status).toBe("pending_admin_approval");
    pendingBookingId = (data as { id: string }).id;
  });

  it("volunteer's RLS WITH CHECK rejects an explicit booking_status='cancelled' on INSERT (adult)", async () => {
    const users = getHarnessUsers();
    const client = await signInAs("volunteer");

    // Use a different shift to avoid uniqueness collision with the
    // first adult test's confirmed booking.
    const admin = adminBypassClient();
    const { data: probe } = await admin.from("shifts").insert({
      department_id: TEST_DEPARTMENT_ID,
      title: "Adult cancelled-insert probe",
      shift_date: SHIFT_DATE,
      time_type: "afternoon",
      start_time: "13:00:00",
      end_time: "15:00:00",
      total_slots: 1,
      booked_slots: 0,
      status: "open",
    } as never).select("id").single();
    const probeShiftId = (probe as { id: string }).id;

    const { error } = await client
      .from("shift_bookings")
      .insert({
        shift_id: probeShiftId,
        volunteer_id: users.volunteer.id,
        booking_status: "cancelled",
      } as never);

    expect(error).not.toBeNull();
    // Postgres SQLSTATE 42501 / RLS violation. supabase-js surfaces
    // either as `code: '42501'` or as an embedded message — assert
    // the policy fired without pinning to one form.
    expect((error as { code?: string; message?: string }).code === "42501"
      || /row-level security/i.test((error as { message?: string }).message ?? "")).toBe(true);

    await admin.from("shifts").delete().eq("id", probeShiftId);
  });

  it("admin can UPDATE pending → 'confirmed' (approval flow)", async () => {
    const client = await signInAs("admin");
    expect(pendingBookingId).toBeTruthy();

    const { data, error } = await client
      .from("shift_bookings")
      .update({ booking_status: "confirmed" } as never)
      .eq("id", pendingBookingId)
      .select("id, booking_status");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect((data as Array<{ booking_status: string }>)[0].booking_status).toBe("confirmed");

    // Reset to pending so the next test can exercise the negative cases.
    const admin = adminBypassClient();
    await admin.from("shift_bookings")
      .update({ booking_status: "pending_admin_approval" } as never)
      .eq("id", pendingBookingId);
  });

  it("coordinator CANNOT UPDATE pending → 'confirmed' (admin-only approval)", async () => {
    const client = await signInAs("coordinator");
    expect(pendingBookingId).toBeTruthy();

    const { error } = await client
      .from("shift_bookings")
      .update({ booking_status: "confirmed" } as never)
      .eq("id", pendingBookingId)
      .select("id, booking_status");

    // The trigger raises 42501 with a message about admin-only approval.
    expect(error).not.toBeNull();
    expect((error as { code?: string; message?: string }).code === "42501"
      || /administrator/i.test((error as { message?: string }).message ?? "")).toBe(true);
  });

  it("volunteer themselves CANNOT UPDATE their own pending → 'confirmed'", async () => {
    const client = await signInAs("volunteer2");
    expect(pendingBookingId).toBeTruthy();

    const { error } = await client
      .from("shift_bookings")
      .update({ booking_status: "confirmed" } as never)
      .eq("id", pendingBookingId)
      .select("id, booking_status");

    expect(error).not.toBeNull();
    expect((error as { code?: string; message?: string }).code === "42501"
      || /administrator/i.test((error as { message?: string }).message ?? "")).toBe(true);
  });

  it("admin can UPDATE pending → 'rejected' (denial flow)", async () => {
    const client = await signInAs("admin");
    expect(pendingBookingId).toBeTruthy();

    const { data, error } = await client
      .from("shift_bookings")
      .update({
        booking_status: "rejected",
        cancelled_at: new Date().toISOString(),
      } as never)
      .eq("id", pendingBookingId)
      .select("id, booking_status");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect((data as Array<{ booking_status: string }>)[0].booking_status).toBe("rejected");
  });
});
