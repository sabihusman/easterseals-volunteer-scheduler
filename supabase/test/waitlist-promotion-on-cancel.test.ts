import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInAs, adminBypassClient, getHarnessUsers } from "./clients";
import { TEST_DEPARTMENT_ID } from "./setup";

/**
 * Regression coverage for the promote_next_waitlist EXECUTE grant
 * (20260613000000_grant_promote_next_waitlist_to_authenticated.sql).
 *
 * The Phase 2 SECURITY DEFINER lockdown (PR #196) revoked EXECUTE on
 * promote_next_waitlist from `authenticated`. But it's invoked by the
 * SECURITY INVOKER trigger trg_waitlist_promote_on_cancel — which runs
 * as the cancelling user. So a volunteer cancelling their own confirmed
 * booking when someone is waitlisted hit:
 *
 *   ERROR 42501: permission denied for function promote_next_waitlist
 *
 * aborting the cancel (HTTP 403 in prod). This test pins the path:
 *
 *   - WITHOUT the grant: the cancel UPDATE below raises 42501 →
 *     `cancel.error` is non-null → this test FAILS.
 *   - WITH the grant: the cancel succeeds AND the waitlisted volunteer
 *     gets a promotion offer (waitlist_offer_expires_at set by
 *     promote_next_waitlist) → this test PASSES.
 *
 * Note: promote_next_waitlist does not flip the waitlisted booking
 * straight to 'confirmed' — it extends a time-boxed offer (sets
 * waitlist_offer_expires_at; the volunteer then accepts via
 * waitlist_accept). The observable proof that promotion ran is that
 * offer timestamp going from NULL to non-NULL.
 *
 * Harness convention: service-role bypass for setup/teardown; the
 * assertion path (the cancel) runs as the authenticated volunteer so
 * the invoker-context trigger fires exactly as it does in prod.
 */

// 7 days out: inside the 14-day booking window and comfortably past
// promote_next_waitlist's "shift must be >30min in the future" guard.
const SHIFT_DATE = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
})();

let shiftId: string;
let volBookingId: string; // volunteer's confirmed booking
let vol2BookingId: string; // volunteer2's waitlisted booking

beforeAll(async () => {
  const admin = adminBypassClient();
  const users = getHarnessUsers();

  // enforce_booking_window requires both volunteers to have emergency
  // contacts, else the booking insert is rejected before we reach the
  // waitlist path. Stamp them via service-role (setup only).
  await admin
    .from("profiles")
    .update({
      emergency_contact_name: "Harness Contact",
      emergency_contact_phone: "555-555-0142",
    } as never)
    .in("id", [users.volunteer.id, users.volunteer2.id]);

  // Single-slot shift so it fills with one confirmed booking and the
  // second volunteer is genuinely a waitlist candidate.
  const { data: shift, error: shiftErr } = await admin
    .from("shifts")
    .insert({
      department_id: TEST_DEPARTMENT_ID,
      created_by: users.admin.id,
      title: "Waitlist-Promote-Cancel Test",
      shift_date: SHIFT_DATE,
      time_type: "morning",
      start_time: "10:00:00",
      end_time: "12:00:00",
      total_slots: 1,
      requires_bg_check: false,
    } as never)
    .select("id")
    .single();
  if (shiftErr || !shift) throw new Error(`shift insert failed: ${shiftErr?.message}`);
  shiftId = (shift as { id: string }).id;
});

afterAll(async () => {
  const admin = adminBypassClient();
  if (shiftId) {
    await admin.from("shift_bookings").delete().eq("shift_id", shiftId);
    await admin.from("shifts").delete().eq("id", shiftId);
  }
});

describe("waitlist promotion on cancel (promote_next_waitlist EXECUTE grant)", () => {
  it("an authenticated volunteer can cancel a confirmed booking when someone is waitlisted, and the waitlisted volunteer is promoted (offered a spot)", async () => {
    const users = getHarnessUsers();

    // --- Volunteer books the only slot (confirmed) ---
    const volClient = await signInAs("volunteer");
    const booked = await volClient
      .from("shift_bookings")
      .insert({
        shift_id: shiftId,
        volunteer_id: users.volunteer.id,
        booking_status: "confirmed",
      } as never)
      .select("id")
      .single();
    expect(booked.error, `confirmed booking insert: ${booked.error?.message}`).toBeNull();
    volBookingId = (booked.data as { id: string }).id;

    // --- Volunteer2 joins the waitlist (slot is full) ---
    const vol2Client = await signInAs("volunteer2");
    const waitlisted = await vol2Client
      .from("shift_bookings")
      .insert({
        shift_id: shiftId,
        volunteer_id: users.volunteer2.id,
        booking_status: "waitlisted",
      } as never)
      .select("id, waitlist_offer_expires_at")
      .single();
    expect(waitlisted.error, `waitlist insert: ${waitlisted.error?.message}`).toBeNull();
    vol2BookingId = (waitlisted.data as { id: string }).id;
    // No active offer yet.
    expect((waitlisted.data as { waitlist_offer_expires_at: string | null }).waitlist_offer_expires_at).toBeNull();

    // --- THE REGRESSION: volunteer cancels their confirmed booking ---
    // This fires trg_waitlist_promote_on_cancel (SECURITY INVOKER) →
    // promote_next_waitlist, as the authenticated volunteer. Without the
    // EXECUTE grant this raises 42501 and the cancel fails (HTTP 403).
    const cancel = await volClient
      .from("shift_bookings")
      .update({ booking_status: "cancelled", cancelled_at: new Date().toISOString() } as never)
      .eq("id", volBookingId)
      .select("id, booking_status")
      .single();
    expect(
      cancel.error,
      `cancel must succeed; 42501 here means promote_next_waitlist EXECUTE is not granted to authenticated: ${cancel.error?.message}`,
    ).toBeNull();
    expect((cancel.data as { booking_status: string }).booking_status).toBe("cancelled");

    // --- Promotion ran: the waitlisted volunteer now has an offer ---
    // Read via service-role so RLS visibility can't mask the result.
    const admin = adminBypassClient();
    const { data: vol2After, error: readErr } = await admin
      .from("shift_bookings")
      .select("waitlist_offer_expires_at, booking_status")
      .eq("id", vol2BookingId)
      .single();
    expect(readErr).toBeNull();
    expect(
      (vol2After as { waitlist_offer_expires_at: string | null }).waitlist_offer_expires_at,
      "waitlisted volunteer should have been offered the freed spot (waitlist_offer_expires_at set by promote_next_waitlist)",
    ).not.toBeNull();
  });
});
