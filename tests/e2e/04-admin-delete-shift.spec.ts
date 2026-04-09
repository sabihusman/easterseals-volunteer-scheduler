import { test, expect } from "@playwright/test";
import { signInAsRole, loginAndVisit } from "./fixtures/session";
import {
  createShift,
  getShift,
  listBookingsForShift,
  countBy,
  getTestDepartmentId,
  uniqueShiftDate,
  expectOk,
  cancelVolunteerBookingsOnDate,
  authHeaders,
  SUPABASE_URL,
} from "./fixtures/db";

/**
 * E2E 4 — Admin hard-deletes a shift with existing bookings.
 *
 * After deletion, NO rows should remain in any of:
 *   - shift_bookings           (FK on shift_id)
 *   - shift_booking_slots      (FK on shift_id via booking)
 *   - volunteer_shift_reports  (FK on shift_id)
 *
 * The shift_delete_cascade migration is supposed to clean these up.
 * This test locks that behavior down — any regression that leaves
 * orphaned rows fails CI.
 *
 * Uses a unique date 32 days in the future + 06:00-07:00 so neither
 * the test volunteer nor the admin (used here as a second booker) has
 * a real-life overlap with the test shift.
 */

// Must be within the 14-day default booking window — see enforce_booking_window
// trigger. Distinct from other E2E specs so the overlap trigger stays quiet.
const SHIFT_DATE_OFFSET_DAYS = 9;

test.describe("Admin hard-deletes shift with bookings", () => {
  test("leaves no orphaned records", async ({
    page,
    context,
    request,
  }) => {
    // --- 1. Coordinator creates a 2-slot shift on a unique date ---
    const coord = await signInAsRole(request, "coordinator");
    const departmentId = await getTestDepartmentId(
      request,
      coord.access_token
    );
    const shiftDate = uniqueShiftDate(SHIFT_DATE_OFFSET_DAYS);
    const shift = await createShift(request, coord.access_token, {
      department_id: departmentId,
      created_by: coord.user.id,
      total_slots: 2,
      title: `E2E-Delete-${Date.now()}`,
      shift_date: shiftDate,
      start_time: "06:00:00",
      end_time: "07:00:00",
    });
    const shiftId = shift.id;

    // --- 2. Pre-cleanup: clear any leftover bookings on that date ---
    const volA = await signInAsRole(request, "volunteer");
    const admin = await signInAsRole(request, "admin");
    await cancelVolunteerBookingsOnDate(
      request,
      volA.access_token,
      volA.user.id,
      shiftDate
    );
    await cancelVolunteerBookingsOnDate(
      request,
      admin.access_token,
      admin.user.id,
      shiftDate
    );

    // --- 3. Two bookers (volunteer + admin) book the shift ---
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

    const bookAdminRes = await request.post(
      `${SUPABASE_URL}/rest/v1/shift_bookings`,
      {
        headers: authHeaders(admin.access_token),
        data: {
          shift_id: shiftId,
          volunteer_id: admin.user.id,
          booking_status: "confirmed",
        },
      }
    );
    await expectOk(bookAdminRes, "admin book");

    const bookingsBefore = await listBookingsForShift(
      request,
      admin.access_token,
      shiftId
    );
    expect(bookingsBefore.length).toBeGreaterThanOrEqual(2);

    // --- 4. Admin signs in via UI (smoke) then issues the DELETE ---
    await loginAndVisit(request, context, page, "admin", "/admin");
    await expect(page.locator("h1, h2").first()).toBeVisible({
      timeout: 15_000,
    });

    const deleteRes = await request.delete(
      `${SUPABASE_URL}/rest/v1/shifts?id=eq.${shiftId}`,
      { headers: authHeaders(admin.access_token) }
    );
    await expectOk(deleteRes, "admin delete shift");
    await new Promise((r) => setTimeout(r, 500));

    // --- 5. Verify no orphans remain ---
    const shiftAfter = await getShift(request, admin.access_token, shiftId);
    expect(shiftAfter, "shift row should be gone").toBeNull();

    const orphanBookings = await countBy(
      request,
      admin.access_token,
      "shift_bookings",
      "shift_id",
      shiftId
    );
    expect(
      orphanBookings,
      "shift_bookings rows must cascade on shift delete"
    ).toBe(0);

    const orphanSlots = await countBy(
      request,
      admin.access_token,
      "shift_booking_slots",
      "shift_id",
      shiftId
    );
    expect(
      orphanSlots,
      "shift_booking_slots rows must cascade on shift delete"
    ).toBe(0);

    const orphanReports = await countBy(
      request,
      admin.access_token,
      "volunteer_shift_reports",
      "shift_id",
      shiftId
    );
    expect(
      orphanReports,
      "volunteer_shift_reports rows must cascade on shift delete"
    ).toBe(0);
  });
});
