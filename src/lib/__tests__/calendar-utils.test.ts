import { describe, it, expect } from "vitest";
import { parseShiftDate } from "@/lib/calendar-utils";

/**
 * `parseShiftDate` exists specifically to avoid the classic
 * "YYYY-MM-DD is parsed as UTC midnight, then displayed in local time
 * as the previous calendar day" bug. The previous off-by-one bug
 * manifested in any timezone west of UTC — a shift on 2026-04-08 would
 * render as "Apr 7" in the UI. These tests lock that behavior down.
 */
describe("parseShiftDate", () => {
  it("returns Invalid Date for null", () => {
    expect(parseShiftDate(null).getTime()).toBeNaN();
  });

  it("returns Invalid Date for undefined", () => {
    expect(parseShiftDate(undefined).getTime()).toBeNaN();
  });

  it("returns Invalid Date for empty string", () => {
    expect(parseShiftDate("").getTime()).toBeNaN();
  });

  it("parses a normal date as local midnight (not UTC midnight)", () => {
    const d = parseShiftDate("2026-04-08");
    // Local getFullYear/getMonth/getDate must match the input regardless
    // of the runner's timezone. This is the whole point of the function.
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3); // April is month index 3
    expect(d.getDate()).toBe(8);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it("does NOT shift the date backwards in western timezones", () => {
    // Compare against the raw `new Date("2026-04-08")` which WOULD
    // shift backwards in UTC-offset locales. parseShiftDate must always
    // stay on the same calendar day as the input.
    const parsed = parseShiftDate("2026-04-08");
    expect(parsed.getDate()).toBe(8);
    // Specifically: the day should NEVER be 7, regardless of timezone.
    expect(parsed.getDate()).not.toBe(7);
  });

  it("handles the first day of the month", () => {
    const d = parseShiftDate("2026-05-01");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4); // May
    expect(d.getDate()).toBe(1);
  });

  it("handles the last day of the month", () => {
    const d = parseShiftDate("2026-01-31");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0); // January
    expect(d.getDate()).toBe(31);
  });

  it("handles Feb 29 on a leap year", () => {
    const d = parseShiftDate("2024-02-29");
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(1); // February
    expect(d.getDate()).toBe(29);
  });

  it("handles US DST spring-forward boundary (second Sunday of March)", () => {
    // In 2026 DST starts Sunday March 8. A shift scheduled for that
    // date must still report as March 8 at 00:00 local — the "skipped"
    // hour happens at 02:00, not midnight, so this should be stable.
    const d = parseShiftDate("2026-03-08");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2); // March
    expect(d.getDate()).toBe(8);
    expect(d.getHours()).toBe(0);
  });

  it("handles US DST fall-back boundary (first Sunday of November)", () => {
    // In 2026 DST ends Sunday November 1. Same reasoning — the repeat
    // hour is at 02:00, midnight is unaffected.
    const d = parseShiftDate("2026-11-01");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(10); // November
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(0);
  });

  it("handles year boundary", () => {
    const d = parseShiftDate("2025-12-31");
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(11); // December
    expect(d.getDate()).toBe(31);
  });
});
