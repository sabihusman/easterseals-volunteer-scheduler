import { test, expect } from "@playwright/test";
import { signInAsRole } from "./fixtures/session";
import {
  createShift,
  getShift,
  listBookingsForShift,
  hardCleanupShift,
  getTestDepartmentId,
  uniqueShiftDate,
  expectOk,
  cancelVolunteerBookingsOnDate,
  authHeaders,
  SUPABASE_URL,
} from "./fixtures/db";

/**
 * E2E 2 — Waitlist promotion lifecycle.
 *
 * Scenario:
 *   1. Coordinator creates a 1-slot shift on a unique date so the
 *      prevent_overlapping_bookings trigger can't fire across tests.
 *   2. Volunteer A books it → confirmed, slot counter = 1.
 *   3. Volunteer B (the admin account, used here as a second booking
 *      identity) attempts to book → trigger demotes to waitlisted.
 *   4. Vol A cancels → cancel trigger fires promote_next_waitlist
 *      which gives Vol B an offer (waitlist_offer_expires_at set).
 *   5. Vol B accepts via the waitlist_accept RPC → becomes confirmed,
 *      slot counter back to 1.
 *
 * The invariant at every step:
 *   shifts.booked_slots == count(shift_bookings WHERE booking_status='confirmed')
 *
 * All steps run through Supabase REST. The earlier version of this
 * test had a browser smoke step that added flake without value; the
 * promotion contract is enforced by triggers, so REST is sufficient.
 */

// Must be within the 14-day default booking window — see enforce_booking_window
// trigger. Distinct from other E2E specs so the overlap trigger stays quiet.
const SHIFT_DATE_OFFSET_DAYS = 8;

test.describe("Waitlist promotion lifecycle", () => {
  let shiftId: string | null = null;
  let coordAccess: string;

  test.afterEach(async ({ playwright }) => {
    if (!shiftId) return;
    const request = await playwright.request.newContext();
    await hardCleanupShift(request, coordAccess, shiftId);
    shiftId = null;
    await request.dispose();
  });

  test("A books, B waitlisted, A cancels, B promoted", async ({
    playwright,
  }) => {
    const request = await playwright.request.newContext();

    // --- 1. Coordinator creates the 1-slot shift ---
    const coord = await signInAsRole(request, "coordinator");
    coordAccess = coord.access_token;
    const departmentId = await getTestDepartmentId(request, coordAccess);
    const shiftDate = uniqueShiftDate(SHIFT_DATE_OFFSET_DAYS);
    const shift = await createShift(request, coordAccess, {
      department_id: departmentId,
      created_by: coord.user.id,
      total_slots: 1,
      title: `E2E-Waitlist-${Date.now()}`,
      shift_date: shiftDate,
      start_time: "06:00:00",
      end_time: "07:00:00",
    });
    shiftId = shift.id;

    // --- 2. Pre-cleanup: clear any leftover bookings the test users
    //    have on this date so the overlap trigger can't fire. ---
    const volA = await signInAsRole(request, "volunteer");
    const volB = await signInAsRole(request, "admin");
    await cancelVolunteerBookingsOnDate(
      request,
      volA.access_token,
      volA.user.id,
      shiftDate
    );
    await cancelVolunteerBookingsOnDate(
      request,
      volB.access_token,
      volB.user.id,
      shiftDate
    );

    // --- 3. Volunteer A books it ---
    const bookARes = await request.post(
      `${SUPABASE_URL}/rest/v1/shift_bookings`,
      {
        headers: authHeaders(volA.access_token),
        data: {
          shift_id: shiftId,
          volunteer_id: volA.user.id,
          booking_status: "confirmed",
        },
      }
    );
    await expectOk(bookARes, "vol A book");
    const bookARows = (await bookARes.json()) as Array<{ id: string }>;
    const volABookingId = bookARows[0].id;

    // Counter invariant after A confirmed: booked_slots = 1, full.
    let current = await getShift(request, coordAccess, shiftId);
    expect(current?.booked_slots).toBe(1);
    expect(current?.status).toBe("full");

    // --- 4. Volunteer B tries to book — trigger demotes to waitlist ---
    const bookBRes = await request.post(
      `${SUPABASE_URL}/rest/v1/shift_bookings`,
      {
        headers: authHeaders(volB.access_token),
        data: {
          shift_id: shiftId,
          volunteer_id: volB.user.id,
          booking_status: "confirmed",
        },
      }
    );
    await expectOk(bookBRes, "vol B book attempt");
    const bookBRows = (await bookBRes.json()) as Array<{
      booking_status: string;
    }>;
    expect(
      bookBRows[0].booking_status,
      "B should be demoted to waitlisted"
    ).toBe("waitlisted");

    // Counter invariant: still 1 confirmed (only A), not 2.
    current = await getShift(request, coordAccess, shiftId);
    expect(current?.booked_slots).toBe(1);

    // --- 5. Vol A cancels → trigger offers slot to B ---
    const cancelRes = await request.patch(
      `${SUPABASE_URL}/rest/v1/shift_bookings?id=eq.${volABookingId}`,
      {
        headers: authHeaders(volA.access_token),
        data: {
          booking_status: "cancelled",
          cancelled_at: new Date().toISOString(),
        },
      }
    );
    await expectOk(cancelRes, "vol A cancel");

    // Give the AFTER trigger a moment to propagate.
    await new Promise((r) => setTimeout(r, 800));

    // Counter invariant: after A cancelled, booked_slots = 0 and
    // B's row should have a waitlist offer.
    current = await getShift(request, coordAccess, shiftId);
    expect(current?.booked_slots).toBe(0);
    expect(current?.status).toBe("open");

    const bookingsNow = await listBookingsForShift(
      request,
      coordAccess,
      shiftId
    );
    const volBBooking = bookingsNow.find(
      (b) => b.volunteer_id === volB.user.id
    );
    expect(volBBooking?.booking_status).toBe("waitlisted");
    expect(
      volBBooking?.waitlist_offer_expires_at,
      "B should have an active offer"
    ).toBeTruthy();

    // --- 6. Vol B accepts via the waitlist_accept RPC ---
    const acceptRes = await request.post(
      `${SUPABASE_URL}/rest/v1/rpc/waitlist_accept`,
      {
        headers: authHeaders(volB.access_token),
        data: { p_booking_id: volBBooking!.id },
      }
    );
    await expectOk(acceptRes, "waitlist_accept");
    await new Promise((r) => setTimeout(r, 500));

    // Final invariant: B is confirmed, booked_slots = 1, status = full.
    current = await getShift(request, coordAccess, shiftId);
    expect(current?.booked_slots).toBe(1);
    expect(current?.status).toBe("full");

    const finalBookings = await listBookingsForShift(
      request,
      coordAccess,
      shiftId
    );
    const volBFinal = finalBookings.find(
      (b) => b.volunteer_id === volB.user.id
    );
    expect(volBFinal?.booking_status).toBe("confirmed");

    await request.dispose();
  });
});
