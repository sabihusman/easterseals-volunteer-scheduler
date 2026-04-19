import { test, expect } from "@playwright/test";
import { signInAsRole, primeBrowserAuth } from "./fixtures/session";
import {
  createShift,
  getShift,
  hardCleanupShift,
  cleanupStaleE2EShifts,
  getTestDepartmentId,
  uniquePastShiftDate,
  expectOk,
  authHeaders,
  SUPABASE_URL,
} from "./fixtures/db";

/**
 * E2E 5 — Shift lifecycle: past shift transition & list placement.
 *
 * Covers the reported bug: past-dated shifts with status 'open'/'full'
 * were showing up in the admin "Upcoming" filter. The fix has three
 * layers, and this spec exercises each:
 *
 *   1. REST: admin creates a shift dated 30 days ago with status='open',
 *      which simulates a shift that existed before the transition job
 *      started running.
 *   2. RPC: calling transition_past_shifts_to_completed() flips it to
 *      'completed'. The same job runs every 15 min via pg_cron in prod.
 *   3. UI: admin visits /admin, sets the Status filter to "Past" → the
 *      shift appears. Sets it to "Upcoming" → the shift does NOT appear.
 *
 * Past-dated shift creation bypasses the enforce_shift_not_ended_on_booking
 * trigger (which is on shift_bookings, not shifts). There is no guard
 * against creating a shift with a past shift_date, so the setup works.
 */

const PAST_OFFSET_DAYS = 30;

// Skipped until migration 20260415000000_shift_lifecycle_rules.sql is
// applied to production. The Playwright suite runs against the
// production URL (see ci.yml PLAYWRIGHT_BASE_URL), so the RPC
// transition_past_shifts_to_completed doesn't exist there yet. Unskip
// in a follow-up PR once `supabase db push --linked` has been run.
test.describe.skip("Past shift placement in admin list", () => {
  let shiftId: string | null = null;
  let adminAccess: string;

  test.afterEach(async ({ playwright }) => {
    if (!shiftId) return;
    const request = await playwright.request.newContext();
    // The block_bookings_on_completed_shifts / prevent_delete_bookings_on_
    // completed_shifts triggers only fire on shift_bookings, not on the
    // shifts table itself, so cleanup still works.
    await hardCleanupShift(request, adminAccess, shiftId);
    shiftId = null;
    await request.dispose();
  });

  test("past shift transitions to completed and shows in Past filter only", async ({
    playwright,
    browser,
  }) => {
    const request = await playwright.request.newContext();

    // --- 1. Admin creates a past-dated shift (status 'open') ---
    const admin = await signInAsRole(request, "admin");
    adminAccess = admin.access_token;
    await cleanupStaleE2EShifts(request, adminAccess);
    const departmentId = await getTestDepartmentId(request, adminAccess);
    const pastDate = uniquePastShiftDate(PAST_OFFSET_DAYS);
    const uniqueTitle = `E2E-Lifecycle-${Date.now()}`;
    const shift = await createShift(request, adminAccess, {
      department_id: departmentId,
      created_by: admin.user.id,
      total_slots: 1,
      title: uniqueTitle,
      shift_date: pastDate,
      start_time: "09:00:00",
      end_time: "10:00:00",
    });
    shiftId = shift.id;

    // The shift starts as 'open' even though it's in the past — that's
    // the exact scenario the bug reproduces.
    expect(shift.status).toBe("open");

    // --- 2. Run the transition RPC ---
    const rpcRes = await request.post(
      `${SUPABASE_URL}/rest/v1/rpc/transition_past_shifts_to_completed`,
      {
        headers: authHeaders(adminAccess),
        data: {},
      }
    );
    await expectOk(rpcRes, "transition_past_shifts_to_completed");

    // --- 3. Verify the shift flipped to 'completed' ---
    const after = await getShift(request, adminAccess, shiftId);
    expect(
      after?.status,
      "past shift should be transitioned to completed"
    ).toBe("completed");

    // --- 4. UI: admin dashboard, Past filter shows it, Upcoming doesn't ---
    const context = await browser.newContext();
    const page = await context.newPage();
    await primeBrowserAuth(context, page, admin);
    await page.goto("/admin");
    await page.waitForLoadState("networkidle");

    // The admin "All Shifts" list is below the stats + leaderboard. The
    // Status select is labeled via its default value "Upcoming" and
    // holds a fixed set of options. Switch to "Past" and look for our
    // unique title.
    const statusSelect = page.getByRole("combobox").filter({ hasText: /upcoming|past|all statuses/i }).first();
    await statusSelect.click();
    await page.getByRole("option", { name: "Past" }).click();
    await expect(
      page.getByText(uniqueTitle, { exact: false })
    ).toBeVisible({ timeout: 10000 });

    // Switch to Upcoming — the completed shift must NOT appear.
    await statusSelect.click();
    await page.getByRole("option", { name: "Upcoming" }).click();
    await expect(
      page.getByText(uniqueTitle, { exact: false })
    ).toHaveCount(0);

    await context.close();
    await request.dispose();
  });
});
