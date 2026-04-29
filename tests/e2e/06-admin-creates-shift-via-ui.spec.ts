import { test, expect } from "@playwright/test";
import { loginAndVisit } from "./fixtures/session";
import {
  cleanupStaleE2EShifts,
  uniqueShiftDate,
} from "./fixtures/db";

/**
 * E2E 6 — Admin creates a shift through the Create Shift dialog,
 *         exercising the Radix-Calendar date picker in a real
 *         Chromium browser.
 *
 * Why this test exists:
 *
 * The Vitest unit test (ShiftFormDialog.datepicker.test.tsx) passed
 * even when the live behavior was broken on Sabih's environment.
 * JSDOM doesn't faithfully reproduce the Radix Portal + Dialog
 * focus-management interaction that production Chromium exhibits;
 * the diagnostic captured zero pointerdown / Calendar.onSelect
 * events on production despite all events firing locally and in
 * JSDOM.
 *
 * This spec exercises the full flow against real Chromium so we
 * catch any future regression that JSDOM masks.
 *
 * Cleanup pattern matches 04-admin-delete-shift: title prefixed
 * with "E2E-" so cleanupStaleE2EShifts() picks up any leftovers
 * from prior aborted runs.
 */

const SHIFT_DATE_OFFSET_DAYS = 11; // distinct from other E2E specs to avoid trigger collisions

// Re-enabled on 2026-04-29 after the date-picker fix saga landed on
// production via PRs #156, #158, #160, and #171's display polish.
// Originally skipped because PLAYWRIGHT_BASE_URL points at production
// and the spec would have tested the OLD broken picker while the fix
// was on a branch — Pattern A trace
// `<label "End Time *"> ... subtree intercepts pointer events` was
// captured on the first run as evidence that the bug repro'd in CI
// Chromium too. With all four layered defenses now on prod, the
// spec exercises the full create-shift flow against the FIXED picker
// and verifies the load-bearing onSelect → setForm → save path that
// JSDOM unit tests can't reach (per the file header comment).
test("admin creates a shift via the Create Shift dialog (date picker works end-to-end)", async ({ page, context, request }) => {
  const session = await loginAndVisit(
    request,
    context,
    page,
    "admin",
    "/coordinator/manage",
  );

  // Pre-clean any stale E2E shifts from prior runs.
  await cleanupStaleE2EShifts(request, session.access_token);

  // Open the dialog. The trigger button says "New Shift" but the
  // dialog title is "Create Shift" — match the dialog by its actual
  // accessible name (derived from DialogTitle).
  await page.getByRole("button", { name: /new shift/i }).click();
  const dialog = page.getByRole("dialog", { name: /create shift/i });
  await expect(dialog).toBeVisible();

  // Fill the title with a unique E2E marker so we can find/clean it.
  const shiftDate = uniqueShiftDate(SHIFT_DATE_OFFSET_DAYS); // YYYY-MM-DD
  const dayOfMonth = parseInt(shiftDate.split("-")[2], 10).toString();
  const shiftTitle = `E2E-DatePickerFlow-${shiftDate}`;
  await dialog.getByPlaceholder(/morning grounds keeping/i).fill(shiftTitle);

  // ── Date picker (the load-bearing assertion) ─────────────────
  // Open the calendar popover.
  await dialog.getByRole("button", { name: /select a date|pick a date/i }).click();

  // Wait for the calendar grid to appear (Radix Portal renders
  // OUTSIDE the dialog DOM tree; query at the page level).
  const calendar = page.getByRole("grid");
  await expect(calendar).toBeVisible();

  // Pick a target day. uniqueShiftDate gives us a date inside the
  // calendar's visible month most of the time, but if the day-of-
  // month is in the next month we need to navigate forward.
  // Simpler approach: just pick the day-of-month that uniqueShiftDate
  // produced. If the calendar is showing the current month and the
  // target is in the next month, navigate via the next-month button.
  const targetMonthYear = new Date(shiftDate + "T00:00:00").toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
  // Repeat-click "next month" up to 12 times until the caption matches.
  for (let i = 0; i < 12; i++) {
    const captionText = await calendar.locator(".rdp-caption_label, [role='presentation']").first().textContent().catch(() => "");
    if (captionText?.includes(targetMonthYear)) break;
    // react-day-picker's next-month button is rendered by the
    // shadcn Calendar wrapper as nav_button_next.
    const nextBtn = page.getByRole("button", { name: /go to next month|next month/i }).first();
    if (await nextBtn.count() === 0) break;
    await nextBtn.click();
  }

  // Click the day cell. react-day-picker renders day buttons with
  // name="day" and the day-of-month as text content. Use the first
  // matching button (in-month cells appear before outside-month
  // preview cells in DOM order).
  await page.locator(`button[name="day"]:has-text("${dayOfMonth}")`).first().click();

  // Assertion 1: trigger label updates to the formatted date.
  // (This is the assertion that the JSDOM unit test also makes —
  // but in real Chromium against real Radix portals.)
  //
  // Trigger format from src/components/shared/DatePicker.tsx:
  //   {dateValue ? format(dateValue, "MMMM d, yyyy") : <placeholder />}
  // → e.g. "May 10, 2026". Matching just `targetMonthYear` ("May 2026")
  // FAILED because the day-of-month + comma sit between them in the
  // actual label. We assert the full expected string instead.
  const expectedTriggerLabel = new Date(shiftDate + "T00:00:00").toLocaleString(
    "en-US",
    { month: "long", day: "numeric", year: "numeric" },
  );
  await expect(
    dialog.getByRole("button", { name: new RegExp(expectedTriggerLabel, "i") }),
  ).toBeVisible();

  // ── Fill remaining required fields ─────────────────────────────
  // Department: Radix Select. In real Chromium the click works.
  await dialog.getByRole("combobox").click();
  // The first available option should be safe; tests that need a
  // specific dept use getTestDepartmentId.
  await page.getByRole("option").first().click();

  // Times: HH:MM:SS strings via the TimePicker stub-equivalent.
  // In real Chromium the TimePicker is a Popover too; for E2E we
  // type into the visible input the picker controls.
  // Simpler: directly fill the input the time picker writes to.
  // The shift form has two TimePicker components. Open and pick
  // 09:00 / 12:00 — but if that's brittle, fallback to leaving
  // the defaults (the form has reasonable defaults for admin).
  // Inspecting the implementation: TimePicker auto-writes to its
  // value on change. For now, rely on the form's defaults if any,
  // and fail visibly if validation rejects.
  // (If this is brittle in practice, the spec gets updated.)

  // ── Save ──────────────────────────────────────────────────────
  await dialog.getByRole("button", { name: /create shift/i }).click();

  // Assertion 2: dialog closes.
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });

  // Assertion 3: success toast or visible row in the table for
  // the new shift. Look for the shift title in the page body.
  await expect(page.getByText(shiftTitle)).toBeVisible({ timeout: 10_000 });

  // ── Cleanup: delete the shift we just created ─────────────────
  await cleanupStaleE2EShifts(request, session.access_token);
});
