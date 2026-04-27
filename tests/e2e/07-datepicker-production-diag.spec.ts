import { test, expect } from "@playwright/test";
import { loginAndVisit } from "./fixtures/session";

/**
 * E2E 7 — DIAGNOSTIC: drives the Create Shift date picker against
 * the production deploy, captures console output and screenshots,
 * and reports observations regardless of whether the assertions
 * pass.
 *
 * Why this exists:
 *
 * After PR #156's `modal={false}` fix, Sabih's manual verification
 * still showed the bug. PR #158 added a layered fix
 * (onPointerDownOutside + onOpenAutoFocus + initialFocus removal).
 * This spec captures real-Chromium evidence of whether the bug
 * still reproduces against whatever is currently deployed —
 * including any leftover [DatePicker DIAG] console output if the
 * diagnostic from #156 hasn't been cleaned up yet.
 *
 * Soft assertions (`expect.soft`) so the full evidence is always
 * reported, not just "PASS" or the first failure.
 *
 * Four possible outcomes per the diagnostic plan:
 *   A. Trigger updated AND DIAG shows full event chain
 *   B. Trigger NOT updated AND DIAG shows Pattern A (open/close only)
 *   C. No DIAG lines, trigger updated (diagnostic cleaned up + fix works)
 *   D. Spec fails to run — report what blocked it
 */

test("date picker captures click events and updates form state (production diag)", async ({ page, context, request }) => {
  // Capture every console event for the entire test BEFORE we
  // navigate, so we don't miss early DIAG output.
  const consoleLines: string[] = [];
  page.on("console", (msg) => {
    consoleLines.push(`[${msg.type()}] ${msg.text()}`);
  });

  // Sign in as admin and land on Manage Shifts. baseURL comes
  // from PLAYWRIGHT_BASE_URL (defaults to production main).
  await loginAndVisit(request, context, page, "admin", "/coordinator/manage");

  // Open the Create Shift dialog. Trigger button label is "New Shift",
  // dialog title is "Create Shift" (different — see PR #158 for details).
  await page.getByRole("button", { name: /new shift/i }).click();
  const dialog = page.getByRole("dialog", { name: /create shift/i });
  await expect.soft(dialog).toBeVisible({ timeout: 10_000 });

  await page.screenshot({ path: "test-results/datepicker-diag-01-dialog-open.png", fullPage: true });

  // Snapshot: full HTML around the date trigger area, useful if the
  // selector misses or the layout differs from expectations.
  const triggerRegionHTML = await dialog.locator("text=/Date \\*/").locator("xpath=..").innerHTML().catch(() => "(failed to capture)");

  // Click the date trigger. Placeholder string varies by environment
  // ("Select a date" or "Pick a date"). Match either.
  const dateTrigger = dialog.getByRole("button", { name: /select a date|pick a date/i }).first();
  await dateTrigger.click();

  // Wait for the calendar grid (Radix Portal — query at page level).
  const calendarGrid = page.getByRole("grid");
  await expect.soft(calendarGrid).toBeVisible({ timeout: 5_000 });

  await page.screenshot({ path: "test-results/datepicker-diag-02-calendar-open.png", fullPage: true });

  // Capture trigger label BEFORE clicking a day. The trigger button's
  // accessible name will be either the placeholder OR a formatted date.
  const triggerLabelBefore = await dateTrigger.textContent();

  // Pick a day cell. react-day-picker buttons have name="day" and
  // textContent is the day-of-month. Pick a stable in-month day:
  // if today is in the first half of the month, pick day 28; otherwise
  // pick day 5. Either guarantees a non-current-day in the visible grid.
  const today = new Date().getDate();
  const targetDayOfMonth = today < 15 ? "28" : "5";

  // Find the day button. Use the first match — react-day-picker
  // renders in-month cells before any outside-month preview cells
  // in DOM order, so first() is the in-month cell.
  const dayButton = page.locator(`button[name="day"]:has-text("${targetDayOfMonth}")`).first();
  await dayButton.waitFor({ state: "visible", timeout: 5_000 });
  // Click without { force: true } — we want to see if the click is
  // intercepted by another element (Pattern A would surface here as
  // a Playwright "subtree intercepts pointer events" message).
  await dayButton.click({ trial: false }).catch((err) => {
    // Don't throw — capture the error in observations and continue
    // so the report includes screenshots + console output.
    consoleLines.push(`[click-error] ${String(err).slice(0, 800)}`);
  });

  // Brief wait for any state updates.
  await page.waitForTimeout(750);

  await page.screenshot({ path: "test-results/datepicker-diag-03-after-day-click.png", fullPage: true });

  // Capture trigger label AFTER click. If the click landed and
  // onSelect/onChange fired, this should be a formatted date like
  // "April 28, 2026". If Pattern A is reproducing, this stays as
  // the original placeholder text.
  const triggerLabelAfter = await dateTrigger.textContent();

  // Filter for DatePicker DIAG lines (may be empty if production
  // already cleaned up the instrumentation post-#156).
  const diagLines = consoleLines.filter((line) => line.includes("[DatePicker DIAG]"));

  // ── Report block ────────────────────────────────────────────────
  // Everything goes to stdout via console.log. Playwright's `list`
  // reporter captures stdout into the playwright-output.txt artifact,
  // which the comment-on-pr workflow tail-copies into the PR comment.
  console.log("==================== DatePicker production diag ====================");
  console.log(`Target day-of-month picked:  ${targetDayOfMonth}`);
  console.log(`Trigger label BEFORE click:  ${JSON.stringify(triggerLabelBefore)}`);
  console.log(`Trigger label AFTER click:   ${JSON.stringify(triggerLabelAfter)}`);
  console.log(`Trigger label changed:       ${triggerLabelBefore !== triggerLabelAfter}`);
  console.log(`Total console lines:         ${consoleLines.length}`);
  console.log(`[DatePicker DIAG] lines:     ${diagLines.length}`);
  console.log("---- DIAG lines ----");
  if (diagLines.length === 0) {
    console.log("(none — diagnostic appears to be cleaned up from production)");
  } else {
    for (const line of diagLines) console.log(line);
  }
  console.log("---- All console lines (last 80) ----");
  for (const line of consoleLines.slice(-80)) console.log(line);
  console.log("---- HTML snapshot of date trigger region ----");
  console.log(triggerRegionHTML.slice(0, 2_000));
  console.log("=====================================================================");

  // ── Soft assertions (don't short-circuit reporting) ─────────────
  // Outcome A or C: trigger label changed → fix works.
  // Outcome B: trigger label unchanged → bug reproduces.
  expect.soft(triggerLabelAfter, "Trigger label did not update — date click failed").not.toBe(triggerLabelBefore);
  // Outcome A only: DIAG lines captured (production still has the
  // instrumentation). Outcome C and the fixed-state version of B
  // both produce zero DIAG lines.
  if (diagLines.length === 0) {
    console.log("[note] Zero DIAG lines — production likely cleaned up the instrumentation. " +
                "If trigger label DID change, this is outcome C (fix works, no diag). " +
                "If trigger label DID NOT change, the bug is reproducing without the diagnostic " +
                "to confirm Pattern A — the instrumentation needs to be re-applied to debug further.");
  }
});
