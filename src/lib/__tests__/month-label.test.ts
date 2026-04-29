import { describe, it, expect } from "vitest";
import { format } from "date-fns";

/**
 * Pin the date-parsing behavior that drove audit-V2.
 *
 * `ShiftHistory.tsx` builds a "yyyy-MM" key per shift, then renders
 * the bucket label via `format(new Date(month + "-01..."), "MMM yyyy")`.
 *
 * The bug was a missing "T00:00:00" suffix on the display formatter:
 *
 *   - `new Date("2026-04-01")`            → UTC midnight Apr 1 →
 *      March 31 evening in US local time → format() renders "Mar 2026"
 *   - `new Date("2026-04-01T00:00:00")`   → LOCAL midnight Apr 1 →
 *      format() renders "Apr 2026" everywhere west of UTC.
 *
 * date-fns interprets the Date in local TZ; the bug was upstream in
 * how the Date was constructed. These tests document the contract so
 * a future refactor doesn't drop the suffix again.
 *
 * Note: Vitest runs in the host's local timezone. The "Mar 2026"
 * regression only manifests in TZs west of UTC (i.e. negative
 * offsets). We assert the FIXED behavior, which holds in any TZ:
 * with the "T00:00:00" suffix, the local-midnight Date always
 * formats as the requested month.
 */

describe("Hours-by-Month label formatter (audit V2)", () => {
  it("with T00:00:00 suffix, formats April input as 'Apr ____'", () => {
    expect(format(new Date("2026-04-01T00:00:00"), "MMM yyyy")).toMatch(/^Apr 2026$/);
  });

  it("with T00:00:00 suffix, formats December input as 'Dec ____' (no rollover)", () => {
    // Year-end month is the worst-case for the UTC-midnight bug:
    // "2026-12-01" parsed as UTC midnight is Nov 30 evening west of
    // UTC, which would render as "Nov 2026" — wrong by a year on
    // top of the off-by-one month.
    expect(format(new Date("2026-12-01T00:00:00"), "MMM yyyy")).toMatch(/^Dec 2026$/);
  });

  it("regression marker: the BAD form (no suffix) can drift on negative-offset TZs", () => {
    // We can't force a TZ in vitest without a date-mock library, but
    // we can pin the constructor difference at the millisecond level.
    // `new Date("YYYY-MM-DD")` is parsed as UTC; `+ "T00:00:00"` is
    // parsed as local. They produce DIFFERENT Date instances unless
    // the runtime TZ is exactly UTC.
    const utcMidnight = new Date("2026-04-01");
    const localMidnight = new Date("2026-04-01T00:00:00");

    if (new Date().getTimezoneOffset() === 0) {
      // In UTC, both forms are identical (same absolute instant).
      expect(utcMidnight.getTime()).toBe(localMidnight.getTime());
    } else {
      // In any other TZ, they differ by the TZ offset. This is what
      // drives the "Mar 2026" rendering of an April booking on a CDT
      // user's machine — the bug fixed in this PR.
      expect(utcMidnight.getTime()).not.toBe(localMidnight.getTime());
    }
  });
});
