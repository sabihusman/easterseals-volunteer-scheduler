import { describe, it, expect } from "vitest";
import {
  shiftEndAt,
  isUpcoming,
  isPast,
  isBookable,
  isEditable,
  filterUpcoming,
  filterPast,
  type ShiftLifecycleInput,
} from "../shift-lifecycle";

// A fixed "now" anchor so the tests don't drift with the wall clock.
// Chosen to reproduce the original bug: Apr 19 2026, 3 PM local, while
// there are shifts on Apr 9–17 (past) and Apr 20+ (future).
const NOW = new Date("2026-04-19T15:00:00");

function makeShift(
  overrides: Partial<ShiftLifecycleInput> = {}
): ShiftLifecycleInput {
  return {
    shift_date: "2026-04-20",
    start_time: "09:00:00",
    end_time: "12:00:00",
    time_type: "custom",
    status: "open",
    ...overrides,
  };
}

describe("shiftEndAt", () => {
  // Dates without a 'Z' suffix parse as local time. We assert on the
  // local getHours()/getDate() so these tests pass in any TZ.
  it("uses the explicit end_time when present", () => {
    const s = makeShift({ shift_date: "2026-04-09", end_time: "14:00:00" });
    const d = shiftEndAt(s);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3); // April (0-indexed)
    expect(d.getDate()).toBe(9);
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(0);
  });

  it.each([
    ["morning", 12],
    ["afternoon", 16],
    ["all_day", 17],
  ] as const)("defaults %s shifts to hour %d", (time_type, hour) => {
    const s = makeShift({
      shift_date: "2026-04-10",
      end_time: null,
      time_type,
    });
    expect(shiftEndAt(s).getHours()).toBe(hour);
  });

  it("falls back to hour 17 for unknown time_type with null end_time", () => {
    const s = makeShift({
      shift_date: "2026-04-10",
      end_time: null,
      time_type: "unknown-type",
    });
    expect(shiftEndAt(s).getHours()).toBe(17);
  });
});

describe("isUpcoming / isPast (the reported bug)", () => {
  // These are the EXACT shifts the user reported: Apr 9–17, 2026,
  // status 'open' or 'full', sitting in the admin "Upcoming" list
  // on Apr 19. They must all be classified as past.
  const reportedBugShifts: Array<[string, string, string, string]> = [
    ["2026-04-09", "12:00:00", "12:30:00", "open"],      // Brain Test
    ["2026-04-09", "14:00:00", "15:00:00", "full"],      // Adult Test
    ["2026-04-09", "15:30:00", "16:00:00", "full"],      // Coordinator Test
    ["2026-04-10", "10:00:00", "14:00:00", "open"],      // Grounds Test
    ["2026-04-17", "09:00:00", "11:00:00", "open"],      // last one in the window
  ];

  it.each(reportedBugShifts)(
    "classifies %s %s-%s (%s) as past",
    (shift_date, start_time, end_time, status) => {
      const s = makeShift({ shift_date, start_time, end_time, status });
      expect(isPast(s, NOW)).toBe(true);
      expect(isUpcoming(s, NOW)).toBe(false);
    }
  );

  it("classifies a shift ending in the future as upcoming", () => {
    const s = makeShift({
      shift_date: "2026-04-20",
      end_time: "10:00:00",
    });
    expect(isUpcoming(s, NOW)).toBe(true);
    expect(isPast(s, NOW)).toBe(false);
  });

  it("classifies a shift ending right now as past (boundary)", () => {
    const s = makeShift({
      shift_date: "2026-04-19",
      end_time: "15:00:00",
    });
    // shiftEndAt === NOW → `> now` is false → past.
    expect(isPast(s, NOW)).toBe(true);
  });

  it("classifies a shift that started today but ends later today as upcoming", () => {
    const s = makeShift({
      shift_date: "2026-04-19",
      start_time: "10:00:00",
      end_time: "17:00:00",
    });
    expect(isUpcoming(s, NOW)).toBe(true);
  });
});

describe("isBookable", () => {
  it("is true for upcoming open shift", () => {
    expect(isBookable(makeShift({ status: "open" }), NOW)).toBe(true);
  });

  it("is true for upcoming full shift (volunteers can still join waitlist)", () => {
    expect(isBookable(makeShift({ status: "full" }), NOW)).toBe(true);
  });

  it("is false for past shift even if status is still 'open'", () => {
    const s = makeShift({
      shift_date: "2026-04-10",
      end_time: "14:00:00",
      status: "open",
    });
    expect(isBookable(s, NOW)).toBe(false);
  });

  it("is false for completed shift", () => {
    expect(
      isBookable(makeShift({ status: "completed" }), NOW)
    ).toBe(false);
  });

  it("is false for cancelled shift", () => {
    expect(
      isBookable(makeShift({ status: "cancelled" }), NOW)
    ).toBe(false);
  });
});

describe("isEditable", () => {
  it.each([
    ["open", true],
    ["full", true],
    ["completed", false],
    ["cancelled", false],
  ] as const)("status=%s → editable=%s", (status, editable) => {
    expect(isEditable(makeShift({ status }))).toBe(editable);
  });
});

describe("filterUpcoming / filterPast", () => {
  it("partitions mixed shifts into upcoming and past exactly once each", () => {
    const shifts = [
      makeShift({ shift_date: "2026-04-09", end_time: "12:30:00" }),  // past
      makeShift({ shift_date: "2026-04-17", end_time: "11:00:00" }),  // past
      makeShift({ shift_date: "2026-04-20", end_time: "12:00:00" }),  // upcoming
      makeShift({ shift_date: "2026-05-01", end_time: "17:00:00" }),  // upcoming
    ];

    const upcoming = filterUpcoming(shifts, NOW);
    const past = filterPast(shifts, NOW);

    expect(upcoming.length + past.length).toBe(shifts.length);
    expect(upcoming.every((s) => s.shift_date >= "2026-04-20")).toBe(true);
    expect(past.every((s) => s.shift_date <= "2026-04-17")).toBe(true);
  });
});
