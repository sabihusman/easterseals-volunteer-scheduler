import { describe, it, expect } from "vitest";

/**
 * Consistency score & extended-booking threshold.
 *
 * Product rule: a volunteer must complete at least 5 shifts and have
 * a 90% or better attendance rate over their last 5 shifts to unlock
 * the 21-day booking window. Otherwise the window is capped at 14 days.
 *
 * This mirrors the Postgres `recalculate_consistency()` function and
 * the UI gate in BrowseShifts.tsx / SlotSelectionDialog.tsx.
 */

interface BookingOutcome {
  confirmation_status: "confirmed" | "no_show" | "cancelled" | "pending_confirmation";
  booking_status: "confirmed" | "waitlisted" | "cancelled";
}

/**
 * Pure TS mirror of the server-side consistency calculation.
 *
 *   attended = bookings where booking_status != 'cancelled'
 *              AND confirmation_status != 'no_show'
 *   window   = last 5 bookings
 *   score    = round(attended / window * 100)
 */
export function calculateConsistencyScore(
  lastFive: BookingOutcome[]
): number {
  if (lastFive.length === 0) return 100;
  const window = lastFive.slice(0, 5);
  const attended = window.filter(
    (b) => b.booking_status !== "cancelled" && b.confirmation_status !== "no_show"
  ).length;
  return Math.round((attended / window.length) * 100);
}

/**
 * Unlocks the 21-day booking window when the volunteer has at least
 * 5 shifts in their history and a consistency score of 90% or better.
 */
export function hasExtendedBookingWindow(
  totalShifts: number,
  consistencyScore: number,
  minShifts = 5,
  minScore = 90
): boolean {
  return totalShifts >= minShifts && consistencyScore >= minScore;
}

/**
 * Returns the max booking window in days based on consistency.
 */
export function bookingWindowDays(
  totalShifts: number,
  consistencyScore: number
): number {
  return hasExtendedBookingWindow(totalShifts, consistencyScore) ? 21 : 14;
}

describe("calculateConsistencyScore", () => {
  it("returns 100 for no history (new volunteer)", () => {
    expect(calculateConsistencyScore([])).toBe(100);
  });

  it("returns 100 when all 5 shifts were attended", () => {
    const bookings: BookingOutcome[] = Array(5).fill({
      booking_status: "confirmed",
      confirmation_status: "confirmed",
    });
    expect(calculateConsistencyScore(bookings)).toBe(100);
  });

  it("returns 80 when 1 of 5 shifts was cancelled", () => {
    const bookings: BookingOutcome[] = [
      { booking_status: "confirmed", confirmation_status: "confirmed" },
      { booking_status: "confirmed", confirmation_status: "confirmed" },
      { booking_status: "cancelled", confirmation_status: "pending_confirmation" },
      { booking_status: "confirmed", confirmation_status: "confirmed" },
      { booking_status: "confirmed", confirmation_status: "confirmed" },
    ];
    expect(calculateConsistencyScore(bookings)).toBe(80);
  });

  it("returns 80 when 1 of 5 shifts was no-showed", () => {
    const bookings: BookingOutcome[] = [
      { booking_status: "confirmed", confirmation_status: "confirmed" },
      { booking_status: "confirmed", confirmation_status: "no_show" },
      { booking_status: "confirmed", confirmation_status: "confirmed" },
      { booking_status: "confirmed", confirmation_status: "confirmed" },
      { booking_status: "confirmed", confirmation_status: "confirmed" },
    ];
    expect(calculateConsistencyScore(bookings)).toBe(80);
  });

  it("only considers the most recent 5 shifts", () => {
    const bookings: BookingOutcome[] = [
      ...Array(5).fill({
        booking_status: "confirmed",
        confirmation_status: "confirmed",
      }),
      // Older cancel should NOT pull the score down.
      { booking_status: "cancelled", confirmation_status: "pending_confirmation" },
      { booking_status: "cancelled", confirmation_status: "pending_confirmation" },
    ];
    expect(calculateConsistencyScore(bookings)).toBe(100);
  });
});

describe("hasExtendedBookingWindow — the 90% / 5-shift gate", () => {
  it("locks window for a brand-new volunteer (0 shifts)", () => {
    expect(hasExtendedBookingWindow(0, 100)).toBe(false);
  });

  it("locks window below the 5-shift minimum", () => {
    expect(hasExtendedBookingWindow(4, 100)).toBe(false);
  });

  it("locks window at exactly 5 shifts with 89% consistency", () => {
    expect(hasExtendedBookingWindow(5, 89)).toBe(false);
  });

  it("unlocks window at exactly 5 shifts with 90% consistency (boundary)", () => {
    expect(hasExtendedBookingWindow(5, 90)).toBe(true);
  });

  it("unlocks window with 10 shifts and 95% consistency", () => {
    expect(hasExtendedBookingWindow(10, 95)).toBe(true);
  });

  it("locks window at 20 shifts with 85% consistency (flaky volunteer)", () => {
    expect(hasExtendedBookingWindow(20, 85)).toBe(false);
  });

  it("unlocks at exactly 100% (perfect record)", () => {
    expect(hasExtendedBookingWindow(5, 100)).toBe(true);
  });
});

describe("bookingWindowDays", () => {
  it("returns 14 for an unqualified volunteer", () => {
    expect(bookingWindowDays(4, 100)).toBe(14);
    expect(bookingWindowDays(5, 89)).toBe(14);
    expect(bookingWindowDays(0, 0)).toBe(14);
  });

  it("returns 21 for a qualified volunteer", () => {
    expect(bookingWindowDays(5, 90)).toBe(21);
    expect(bookingWindowDays(100, 100)).toBe(21);
  });
});

describe("integration: score calculation -> window gate", () => {
  it("1 cancel out of 5 drops below threshold (80% < 90%) and locks window", () => {
    const bookings: BookingOutcome[] = [
      { booking_status: "confirmed", confirmation_status: "confirmed" },
      { booking_status: "confirmed", confirmation_status: "confirmed" },
      { booking_status: "cancelled", confirmation_status: "pending_confirmation" },
      { booking_status: "confirmed", confirmation_status: "confirmed" },
      { booking_status: "confirmed", confirmation_status: "confirmed" },
    ];
    const score = calculateConsistencyScore(bookings);
    expect(score).toBe(80);
    expect(hasExtendedBookingWindow(5, score)).toBe(false);
    expect(bookingWindowDays(5, score)).toBe(14);
  });

  it("perfect 5-shift record unlocks the 21-day window", () => {
    const bookings: BookingOutcome[] = Array(5).fill({
      booking_status: "confirmed",
      confirmation_status: "confirmed",
    });
    const score = calculateConsistencyScore(bookings);
    expect(score).toBe(100);
    expect(hasExtendedBookingWindow(5, score)).toBe(true);
    expect(bookingWindowDays(5, score)).toBe(21);
  });
});
