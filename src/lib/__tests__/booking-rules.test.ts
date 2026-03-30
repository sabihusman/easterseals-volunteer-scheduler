import { describe, it, expect } from "vitest";

/**
 * Pure business logic extracted for testing.
 * These functions mirror the rules enforced by the database triggers
 * and the client-side validation in the booking flow.
 */

/** Check if a shift is within the booking window */
function isWithinBookingWindow(shiftDate: string, extendedBooking: boolean): boolean {
  const daysAhead = Math.ceil(
    (new Date(shiftDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );
  const maxDays = extendedBooking ? 21 : 14;
  return daysAhead <= maxDays;
}

/** Check if cancellation is allowed (must be > 48 hours before shift) */
function canCancel(shiftDate: string, now: Date = new Date()): boolean {
  const shiftTime = new Date(shiftDate).getTime();
  const hoursUntilShift = (shiftTime - now.getTime()) / (1000 * 60 * 60);
  return hoursUntilShift > 48;
}

/** Calculate consistency score: % of last N shifts not cancelled */
function calculateConsistency(
  lastBookings: { booking_status: string }[],
  windowSize: number = 5
): number {
  const recent = lastBookings.slice(0, windowSize);
  if (recent.length === 0) return 100;
  const completed = recent.filter((b) => b.booking_status !== "cancelled").length;
  return Math.round((completed / recent.length) * 100);
}

/** Check if consistency meets threshold */
function meetsConsistencyThreshold(score: number, threshold: number = 90): boolean {
  return score >= threshold;
}

/** Admin cap enforcement */
function canAddAdmin(currentAdminCount: number, maxAdmins: number = 2): boolean {
  return currentAdminCount < maxAdmins;
}

/** Friend invite eligibility: only for shifts without BG check */
function canInviteFriend(requiresBgCheck: boolean): boolean {
  return !requiresBgCheck;
}

/** Department restriction filtering */
function filterRestrictedDepartments(
  departments: { id: string; name: string }[],
  restrictedIds: Set<string>
): { id: string; name: string }[] {
  return departments.filter((d) => !restrictedIds.has(d.id));
}

// --- Tests ---

describe("Booking Window Enforcement", () => {
  it("allows booking within 14-day standard window", () => {
    const future = new Date();
    future.setDate(future.getDate() + 10);
    expect(isWithinBookingWindow(future.toISOString().split("T")[0], false)).toBe(true);
  });

  it("rejects booking beyond 14-day standard window", () => {
    const future = new Date();
    future.setDate(future.getDate() + 16);
    expect(isWithinBookingWindow(future.toISOString().split("T")[0], false)).toBe(false);
  });

  it("allows extended booking up to 21 days", () => {
    const future = new Date();
    future.setDate(future.getDate() + 18);
    expect(isWithinBookingWindow(future.toISOString().split("T")[0], true)).toBe(true);
  });

  it("rejects extended booking beyond 21 days", () => {
    const future = new Date();
    future.setDate(future.getDate() + 23);
    expect(isWithinBookingWindow(future.toISOString().split("T")[0], true)).toBe(false);
  });
});

describe("48-Hour Cancellation Rule", () => {
  it("allows cancellation more than 48 hours before shift", () => {
    const now = new Date("2026-03-25T08:00:00Z");
    expect(canCancel("2026-03-28", now)).toBe(true);
  });

  it("blocks cancellation less than 48 hours before shift", () => {
    const now = new Date("2026-03-27T10:00:00Z");
    expect(canCancel("2026-03-28", now)).toBe(false);
  });

  it("blocks cancellation exactly 48 hours before shift", () => {
    const now = new Date("2026-03-28T00:00:00Z");
    expect(canCancel("2026-03-30", now)).toBe(false);
  });
});

describe("Consistency Score Calculation", () => {
  it("returns 100 for no bookings", () => {
    expect(calculateConsistency([])).toBe(100);
  });

  it("returns 100 when all 5 bookings are confirmed", () => {
    const bookings = Array(5).fill({ booking_status: "confirmed" });
    expect(calculateConsistency(bookings)).toBe(100);
  });

  it("returns 80 when 1 of 5 is cancelled", () => {
    const bookings = [
      { booking_status: "confirmed" },
      { booking_status: "confirmed" },
      { booking_status: "cancelled" },
      { booking_status: "confirmed" },
      { booking_status: "confirmed" },
    ];
    expect(calculateConsistency(bookings)).toBe(80);
  });

  it("returns 60 when 2 of 5 are cancelled (below 90% threshold)", () => {
    const bookings = [
      { booking_status: "cancelled" },
      { booking_status: "confirmed" },
      { booking_status: "cancelled" },
      { booking_status: "confirmed" },
      { booking_status: "confirmed" },
    ];
    const score = calculateConsistency(bookings);
    expect(score).toBe(60);
    expect(meetsConsistencyThreshold(score)).toBe(false);
  });

  it("only considers last 5 bookings", () => {
    const bookings = [
      ...Array(5).fill({ booking_status: "confirmed" }),
      { booking_status: "cancelled" }, // 6th, ignored
    ];
    expect(calculateConsistency(bookings)).toBe(100);
  });
});

describe("Admin Cap Enforcement", () => {
  it("allows adding admin when under cap", () => {
    expect(canAddAdmin(1)).toBe(true);
  });

  it("blocks adding admin at cap", () => {
    expect(canAddAdmin(2)).toBe(false);
  });

  it("blocks adding admin over cap", () => {
    expect(canAddAdmin(3)).toBe(false);
  });
});

describe("Friend Invite Eligibility", () => {
  it("allows invite on shifts without BG check", () => {
    expect(canInviteFriend(false)).toBe(true);
  });

  it("blocks invite on shifts requiring BG check", () => {
    expect(canInviteFriend(true)).toBe(false);
  });
});

describe("Department Restriction Filtering", () => {
  const departments = [
    { id: "d1", name: "Grounds" },
    { id: "d2", name: "Kitchen" },
    { id: "d3", name: "Admin" },
  ];

  it("filters out restricted departments", () => {
    const restricted = new Set(["d2"]);
    const result = filterRestrictedDepartments(departments, restricted);
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.id)).toEqual(["d1", "d3"]);
  });

  it("returns all departments when none restricted", () => {
    const result = filterRestrictedDepartments(departments, new Set());
    expect(result).toHaveLength(3);
  });

  it("returns empty array when all restricted", () => {
    const restricted = new Set(["d1", "d2", "d3"]);
    const result = filterRestrictedDepartments(departments, restricted);
    expect(result).toHaveLength(0);
  });
});
