import { test, expect } from "@playwright/test";
import { signInAsRole, loginAndVisit } from "./fixtures/session";
import {
  createShift,
  listBookingsForShift,
  hardCleanupShift,
  getTestDepartmentId,
  uniquePastShiftDate,
  expectOk,
  cancelVolunteerBookingsOnDate,
  authHeaders,
  SUPABASE_URL,
} from "./fixtures/db";

/**
 * E2E 3 — Coordinator confirms volunteer attendance.
 *
 * Flow:
 *   1. Coordinator creates a shift with a date 60+ days in the past
 *      so that (a) the shift is well past confirmation eligibility,
 *      and (b) the date is unlikely to collide with any real
 *      production booking the test volunteer might have.
 *   2. Volunteer books that shift via REST under their own session.
 *   3. Coordinator smoke-loads /coordinator (proves auth works) then
 *      submits the confirmation PATCH via REST — the same call the
 *      UI makes under the hood. We do REST instead of clicking the
 *      DOM because the confirmation control is buried inside a
 *      tab/subview that varies by role config and is brittle to
 *      select against.
 *   4. Verify DB: confirmation_status = 'confirmed', final_hours set,
 *      booking_status still 'confirmed' (booking state is orthogonal
 *      to attendance state).
 */

const PAST_DATE_OFFSET_DAYS = 60;

test.describe("Coordinator confirms attendance", () => {
  let shiftId: string | null = null;
  let coordAccess: string;
  const finalHoursToSet = 2;

  test.afterEach(async ({ playwright }) => {
    if (!shiftId) return;
    const request = await playwright.request.newContext();
    await hardCleanupShift(request, coordAccess, shiftId);
    shiftId = null;
    await request.dispose();
  });

  test("marks volunteer attended and records final_hours", async ({
    page,
    context,
    request,
  }) => {
    // --- 1. Coordinator creates a far-past shift ---
    const coord = await signInAsRole(request, "coordinator");
    coordAccess = coord.access_token;
    const departmentId = await getTestDepartmentId(request, coordAccess);
    const pastDate = uniquePastShiftDate(PAST_DATE_OFFSET_DAYS);
    const shift = await createShift(request, coordAccess, {
      department_id: departmentId,
      created_by: coord.user.id,
      total_slots: 1,
      title: `E2E-Confirm-${Date.now()}`,
      shift_date: pastDate,
      start_time: "06:00:00",
      end_time: "07:00:00",
    });
    shiftId = shift.id;

    // --- 2. Pre-cleanup, then volunteer books under their own session ---
    const vol = await signInAsRole(request, "volunteer");
    await cancelVolunteerBookingsOnDate(
      request,
      vol.access_token,
      vol.user.id,
      pastDate
    );

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
    await expectOk(bookRes, "volunteer book");
    const bookRows = (await bookRes.json()) as Array<{ id: string }>;
    const bookingId = bookRows[0].id;

    // --- 3. Coordinator UI smoke + REST confirmation ---
    await loginAndVisit(request, context, page, "coordinator", "/coordinator");
    await expect(page.locator("h1, h2").first()).toBeVisible({
      timeout: 15_000,
    });

    const confirmRes = await request.patch(
      `${SUPABASE_URL}/rest/v1/shift_bookings?id=eq.${bookingId}`,
      {
        headers: authHeaders(coordAccess),
        data: {
          confirmation_status: "confirmed",
          final_hours: finalHoursToSet,
        },
      }
    );
    await expectOk(confirmRes, "confirm attendance");

    await new Promise((r) => setTimeout(r, 500));

    // --- 4. Verify DB ---
    const bookings = await listBookingsForShift(
      request,
      coordAccess,
      shiftId
    );
    const ours = bookings.find((b) => b.id === bookingId);
    expect(ours?.confirmation_status).toBe("confirmed");
    expect(Number(ours?.final_hours)).toBe(finalHoursToSet);
    expect(ours?.booking_status).toBe("confirmed");
  });
});
