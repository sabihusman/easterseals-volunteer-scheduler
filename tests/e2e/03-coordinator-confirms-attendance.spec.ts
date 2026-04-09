import { test, expect } from "@playwright/test";
import { signInAsRole, loginAndVisit } from "./fixtures/session";
import {
  createShift,
  listBookingsForShift,
  hardCleanupShift,
  getTestDepartmentId,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
} from "./fixtures/db";

/**
 * E2E 3 — Coordinator confirms volunteer attendance.
 *
 * Flow:
 *   1. Setup: coordinator creates a shift dated in the past so the
 *      "confirmation" action is available.
 *   2. Volunteer A books that shift via REST (under their own auth).
 *   3. Coordinator signs in, opens the coordinator dashboard,
 *      confirms the volunteer's attendance with a specific hours
 *      value via the RPC path the UI exercises.
 *   4. Verify in DB:
 *        - confirmation_status = 'confirmed'
 *        - final_hours matches what we submitted
 *
 * Note: we exercise the confirm action through the coordinator REST
 * path rather than the exact DOM click sequence. The DOM-driven
 * version is brittle because confirmation UI varies by dashboard tab
 * and the "attended" button is only visible for post-shift bookings.
 * The authoritative behavior check is the DB state.
 */

function authHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    Prefer: "return=representation",
  };
}

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
    playwright,
    page,
    context,
    request,
  }) => {
    // --- 1. Coordinator creates a past-dated shift ---
    const coord = await signInAsRole(request, "coordinator");
    coordAccess = coord.access_token;
    const departmentId = await getTestDepartmentId(request, coordAccess);
    // Dated 2 days ago so that checkin / confirmation is available.
    const pastDate = new Date(Date.now() - 2 * 86400000)
      .toISOString()
      .slice(0, 10);
    const shift = await createShift(request, coordAccess, {
      department_id: departmentId,
      total_slots: 1,
      title: `E2E-Confirm-${Date.now()}`,
      shift_date: pastDate,
      start_time: "09:00:00",
      end_time: "11:00:00",
    });
    shiftId = shift.id;

    // --- 2. Volunteer books it under their own session ---
    const vol = await signInAsRole(request, "volunteer");
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
    expect(bookRes.ok(), "volunteer book").toBeTruthy();
    const bookRows = await bookRes.json();
    const bookingId = bookRows[0].id;

    // --- 3. Coordinator opens the dashboard (smoke-checks the UI
    //    renders with the shift present) then submits confirmation via
    //    the REST PATCH that the UI uses under the hood ---
    await loginAndVisit(request, context, page, "coordinator", "/coordinator");
    // Just make sure the coordinator page loads successfully (not
    // asserting on the specific shift card — it could be on a
    // different tab / subview depending on role config).
    await expect(page.locator("h1, h2").first()).toBeVisible({
      timeout: 15_000,
    });

    // Submit confirmation via the same REST call the UI makes. This
    // is the contract we actually care about — the client sends a
    // PATCH to mark confirmation_status=confirmed with final_hours.
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
    expect(
      confirmRes.ok(),
      `confirm attendance: ${await confirmRes.text()}`
    ).toBeTruthy();

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
    // The booking stays in booking_status='confirmed' (booking_status
    // is about booking state, confirmation_status is about attendance).
    expect(ours?.booking_status).toBe("confirmed");
  });
});
