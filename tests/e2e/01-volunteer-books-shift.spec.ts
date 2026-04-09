import { test, expect } from "@playwright/test";
import { loginAndVisit, signInAsRole } from "./fixtures/session";
import {
  createShift,
  getShift,
  listBookingsForShift,
  hardCleanupShift,
  cleanupStaleE2EShifts,
  getTestDepartmentId,
  uniqueShiftDate,
  expectOk,
  cancelVolunteerBookingsOnDate,
  authHeaders,
  SUPABASE_URL,
} from "./fixtures/db";

/**
 * E2E 1 — Volunteer books a shift.
 *
 * Two distinct assertions, deliberately separated:
 *
 *   (a) UI smoke: the volunteer's /shifts page renders successfully
 *       under their authenticated session — proves the localStorage
 *       session-injection trick works against the live deployed app.
 *
 *   (b) Booking + counter invariant: the volunteer creates a booking
 *       via REST and shifts.booked_slots decrements correctly. We do
 *       this through REST instead of clicking the UI because the
 *       book-button + slot-selection dialog interaction is fragile
 *       (selectors can change, Cloudflare Turnstile sometimes blocks
 *       headless flows) and the underlying contract being verified is
 *       the trigger behavior, not the click handler.
 *
 * The test shift uses a unique date 30 days in the future at an
 * unusual hour so it can't possibly overlap with anything the test
 * volunteer is booked on in real life or in another test.
 */

// Must be within the volunteer's 14-day default booking window — the
// enforce_booking_window trigger raises P0001 ("Booking window
// exceeded") for anything beyond. Each test uses a distinct day in
// the window so the prevent_overlapping_bookings trigger also stays
// quiet.
const SHIFT_DATE_OFFSET_DAYS = 7;

test.describe("Volunteer books a shift", () => {
  let shiftId: string | null = null;
  let coordAccess: string;
  let shiftDate: string;
  let uniqueTitle: string;

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const coord = await signInAsRole(request, "coordinator");
    coordAccess = coord.access_token;
    // Clean up orphaned E2E shifts using ADMIN token (coordinator
    // RLS can't delete shifts in other departments)
    const admin = await signInAsRole(request, "admin");
    await cleanupStaleE2EShifts(request, admin.access_token);
    const departmentId = await getTestDepartmentId(request, coordAccess);
    shiftDate = uniqueShiftDate(SHIFT_DATE_OFFSET_DAYS);
    uniqueTitle = `E2E-BookFlow-${Date.now()}`;
    const shift = await createShift(request, coordAccess, {
      department_id: departmentId,
      created_by: coord.user.id,
      total_slots: 2,
      title: uniqueTitle,
      shift_date: shiftDate,
      start_time: "06:00:00",
      end_time: "07:00:00",
    });
    shiftId = shift.id;

    // Belt-and-suspenders: cancel any existing bookings the test
    // volunteer might already have on this exact date so the overlap
    // trigger can't fire.
    const vol = await signInAsRole(request, "volunteer");
    await cancelVolunteerBookingsOnDate(
      request,
      vol.access_token,
      vol.user.id,
      shiftDate
    );
    await request.dispose();
  });

  test.afterAll(async ({ playwright }) => {
    if (!shiftId) return;
    const request = await playwright.request.newContext();
    await hardCleanupShift(request, coordAccess, shiftId);
    await request.dispose();
  });

  test("UI smoke: volunteer can load /shifts while authenticated", async ({
    page,
    context,
    request,
  }) => {
    await loginAndVisit(request, context, page, "volunteer", "/shifts");
    // The page must render *something* — a heading is the bare minimum
    // contract. We don't assert on the test shift card here because
    // the production booking-window UI may filter shifts beyond the
    // user's allowed window (our test shift is 30 days out and the
    // volunteer's window may be 14 days), and that filtering is its
    // own correctness story tested in the unit suite.
    await expect(page.locator("h1, h2").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("REST: volunteer books shift, booked_slots decrements", async ({
    request,
  }) => {
    const vol = await signInAsRole(request, "volunteer");

    // Cancel any confirmed bookings this volunteer has on the test
    // date. This MUST run inside the test body (not just beforeAll)
    // because on Playwright retries, beforeAll does NOT re-run — if
    // the previous attempt failed after creating a booking on a
    // DIFFERENT E2E shift that shares the same date+time, the
    // overlap trigger would fire again. Belt-and-suspenders.
    await cancelVolunteerBookingsOnDate(
      request,
      vol.access_token,
      vol.user.id,
      shiftDate
    );

    // Counter starts at 0 of 2.
    const before = await getShift(request, coordAccess, shiftId!);
    expect(before).not.toBeNull();
    expect(before!.booked_slots).toBe(0);
    expect(before!.total_slots).toBe(2);

    // Insert the booking under the volunteer's own session.
    const bookRes = await request.post(
      `${SUPABASE_URL}/rest/v1/shift_bookings`,
      {
        headers: authHeaders(vol.access_token),
        data: {
          shift_id: shiftId,
          volunteer_id: vol.user.id,
          booking_status: "confirmed",
        },
      }
    );
    await expectOk(bookRes, "volunteer booking insert");
    const bookRows = (await bookRes.json()) as Array<{
      id: string;
      booking_status: string;
    }>;
    expect(bookRows[0].booking_status).toBe("confirmed");

    // Give the AFTER trigger a moment to update shifts.booked_slots.
    await new Promise((r) => setTimeout(r, 500));

    // Verify counter decremented.
    const after = await getShift(request, coordAccess, shiftId!);
    expect(after!.booked_slots).toBe(1);
    expect(after!.booked_slots).toBeLessThanOrEqual(after!.total_slots);

    // Verify the booking is visible to the coordinator (RLS sanity).
    const bookings = await listBookingsForShift(
      request,
      coordAccess,
      shiftId!
    );
    const mine = bookings.find((b) => b.volunteer_id === vol.user.id);
    expect(mine, "volunteer's booking should be listed").toBeDefined();
    expect(mine?.booking_status).toBe("confirmed");
  });
});
