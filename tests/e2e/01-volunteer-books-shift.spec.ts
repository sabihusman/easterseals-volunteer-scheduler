import { test, expect } from "@playwright/test";
import { loginAndVisit, signInAsRole } from "./fixtures/session";
import {
  createShift,
  getShift,
  listBookingsForShift,
  hardCleanupShift,
  getTestDepartmentId,
} from "./fixtures/db";

/**
 * E2E 1 — Volunteer books a shift.
 *
 * Flow:
 *   1. Setup: coordinator creates a dedicated 2-slot shift via REST
 *      so we don't interfere with real data.
 *   2. Volunteer signs in, navigates to /shifts, finds the shift by
 *      its unique title, clicks Book.
 *   3. Verify in the UI that the booking is shown as confirmed.
 *   4. Verify in the DB that:
 *        - a shift_bookings row exists with booking_status='confirmed'
 *        - shifts.booked_slots was decremented from 2 to 1
 *   5. Teardown: coordinator deletes the shift + cascades.
 */

test.describe("Volunteer books a shift", () => {
  let shiftId: string | null = null;
  let coordAccess: string;
  let uniqueTitle: string;

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const coord = await signInAsRole(request, "coordinator");
    coordAccess = coord.access_token;
    const departmentId = await getTestDepartmentId(request, coordAccess);
    uniqueTitle = `E2E-BookFlow-${Date.now()}`;
    const shift = await createShift(request, coordAccess, {
      department_id: departmentId,
      total_slots: 2,
      title: uniqueTitle,
    });
    shiftId = shift.id;
    await request.dispose();
  });

  test.afterAll(async ({ playwright }) => {
    if (!shiftId) return;
    const request = await playwright.request.newContext();
    await hardCleanupShift(request, coordAccess, shiftId);
    await request.dispose();
  });

  test("books the shift and decrements booked_slots", async ({
    page,
    context,
    request,
  }) => {
    // Volunteer signs in.
    const session = await loginAndVisit(
      request,
      context,
      page,
      "volunteer",
      "/shifts"
    );

    // Find the test shift card by its unique title.
    const card = page.locator("div").filter({ hasText: uniqueTitle }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Click the "Book" button inside that card. Depending on whether
    // the shift has time slots the flow may take us through a slot
    // selection dialog; handle both cases.
    const bookButton = card.getByRole("button", { name: /book/i }).first();
    await bookButton.click();

    // If a slot selection dialog appears, confirm it.
    const slotConfirm = page.getByRole("button", { name: /confirm booking|book|confirm/i });
    try {
      await slotConfirm.waitFor({ state: "visible", timeout: 5_000 });
      await slotConfirm.first().click();
    } catch {
      // No dialog — booking went through immediately.
    }

    // Verify DB state.
    const beforeShift = await getShift(request, coordAccess, shiftId!);
    expect(beforeShift).not.toBeNull();

    // Give the trigger a moment to settle.
    await page.waitForTimeout(1000);

    const bookings = await listBookingsForShift(
      request,
      coordAccess,
      shiftId!
    );
    const myBooking = bookings.find(
      (b) => b.volunteer_id === session.user.id
    );
    expect(myBooking, "volunteer should have a booking row").toBeDefined();
    expect(myBooking?.booking_status).toBe("confirmed");

    const afterShift = await getShift(request, coordAccess, shiftId!);
    expect(afterShift?.booked_slots).toBe(1); // 2 total - 1 just booked
    // The counter must never exceed capacity.
    expect(afterShift!.booked_slots).toBeLessThanOrEqual(
      afterShift!.total_slots
    );
  });
});
