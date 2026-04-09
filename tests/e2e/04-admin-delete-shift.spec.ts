import { test, expect } from "@playwright/test";
import { signInAsRole, loginAndVisit } from "./fixtures/session";
import {
  createShift,
  getShift,
  listBookingsForShift,
  countBy,
  getTestDepartmentId,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
} from "./fixtures/db";

/**
 * E2E 4 — Admin hard-deletes a shift with existing bookings.
 *
 * After deletion, NO rows should remain in any of:
 *   - shift_bookings     (FK on shift_id)
 *   - shift_booking_slots (FK on shift_id via booking)
 *   - volunteer_shift_reports (FK on shift_id)
 *
 * The shift_delete_cascade migration (20260407_shift_delete_cascade.sql)
 * is supposed to clean these up. This test locks that behavior down —
 * any regression that leaves orphaned rows should fail CI.
 *
 * We use DELETE via REST as the admin (the same call the AdminDashboard
 * UI makes). We do NOT use the UI's cancel-then-delete-later flow;
 * this is specifically the hard-delete path.
 */

function authHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    Prefer: "return=representation",
  };
}

test.describe("Admin hard-deletes shift with bookings", () => {
  test("leaves no orphaned records", async ({
    playwright,
    page,
    context,
    request,
  }) => {
    // --- 1. Coordinator creates a 2-slot shift ---
    const coord = await signInAsRole(request, "coordinator");
    const departmentId = await getTestDepartmentId(
      request,
      coord.access_token
    );
    const shift = await createShift(request, coord.access_token, {
      department_id: departmentId,
      total_slots: 2,
      title: `E2E-Delete-${Date.now()}`,
    });
    const shiftId = shift.id;

    // --- 2. Two volunteers (vol + admin here playing the second vol
    //    role, same as waitlist test) book it ---
    const volA = await signInAsRole(request, "volunteer");
    await request.post(`${SUPABASE_URL}/rest/v1/shift_bookings`, {
      headers: authHeaders(volA.access_token),
      data: {
        shift_id: shiftId,
        volunteer_id: volA.user.id,
        booking_status: "confirmed",
      },
    });

    const admin = await signInAsRole(request, "admin");
    await request.post(`${SUPABASE_URL}/rest/v1/shift_bookings`, {
      headers: authHeaders(admin.access_token),
      data: {
        shift_id: shiftId,
        volunteer_id: admin.user.id,
        booking_status: "confirmed",
      },
    });

    // Sanity: we should have 2 booking rows, counter at 2 (or capped
    // at total_slots — some of them may have demoted to waitlisted
    // depending on trigger behavior, but at least 1 row exists).
    const bookingsBefore = await listBookingsForShift(
      request,
      admin.access_token,
      shiftId
    );
    expect(bookingsBefore.length).toBeGreaterThanOrEqual(1);

    // --- 3. Admin signs in via UI (smoke) then issues the DELETE ---
    await loginAndVisit(request, context, page, "admin", "/admin");
    await expect(page.locator("h1, h2").first()).toBeVisible({
      timeout: 15_000,
    });

    // The DELETE is the same REST call the AdminDashboard UI makes.
    const deleteRes = await request.delete(
      `${SUPABASE_URL}/rest/v1/shifts?id=eq.${shiftId}`,
      { headers: authHeaders(admin.access_token) }
    );
    expect(
      deleteRes.ok(),
      `admin delete shift: ${await deleteRes.text()}`
    ).toBeTruthy();
    await new Promise((r) => setTimeout(r, 500));

    // --- 4. Verify no orphans remain ---
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
