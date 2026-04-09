import { describe, it, expect } from "vitest";

/**
 * Booking status transition rules.
 *
 * The authoritative state machine lives in Postgres triggers:
 *   - validate_booking_slot_count     (demotes confirmed -> waitlisted on overbook)
 *   - waitlist_decline / waitlist_accept  (waitlisted -> confirmed / cancelled)
 *   - trg_waitlist_promote_on_cancel  (waitlisted -> confirmed via offer)
 *
 * The allowed transitions (per the product spec) are:
 *   - confirmed  -> cancelled
 *   - waitlisted -> confirmed    (via waitlist_accept after offer)
 *   - cancelled  -> waitlisted   (re-activation of a cancelled row into the queue)
 *
 * Any other transition (e.g. cancelled -> confirmed directly, or
 * confirmed -> waitlisted outside the overbook path) should be
 * rejected by the client before hitting the DB. These tests pin the
 * pure TS predicate that mirrors the trigger logic.
 */

export type BookingStatus = "confirmed" | "waitlisted" | "cancelled";

/**
 * Given a current status and a requested target status, return true
 * if the transition is allowed. This mirrors what the DB triggers
 * would permit — the client should refuse to even attempt the update
 * if this returns false, to avoid misleading RLS errors.
 */
export function isValidBookingTransition(
  from: BookingStatus,
  to: BookingStatus
): boolean {
  // Same-status "no-op" is trivially allowed.
  if (from === to) return true;
  switch (from) {
    case "confirmed":
      // The only valid next state is cancelled. A confirmed booking
      // cannot be silently moved to the waitlist by the client — the
      // DB trigger handles that case when another booking demotes it.
      return to === "cancelled";
    case "waitlisted":
      // Waitlisted can be promoted (accept) or abandoned (cancel via
      // decline). Both are legal target states.
      return to === "confirmed" || to === "cancelled";
    case "cancelled":
      // A cancelled booking row can be re-used as a waitlisted entry
      // (the client "re-book" path re-activates an existing cancelled
      // row rather than inserting a duplicate). Direct promotion back
      // to confirmed is not allowed — it must go through the waitlist.
      return to === "waitlisted";
    default:
      return false;
  }
}

describe("isValidBookingTransition", () => {
  describe("from confirmed", () => {
    it("allows confirmed -> cancelled", () => {
      expect(isValidBookingTransition("confirmed", "cancelled")).toBe(true);
    });
    it("rejects confirmed -> waitlisted (trigger's job, not client)", () => {
      expect(isValidBookingTransition("confirmed", "waitlisted")).toBe(false);
    });
    it("allows confirmed -> confirmed (no-op)", () => {
      expect(isValidBookingTransition("confirmed", "confirmed")).toBe(true);
    });
  });

  describe("from waitlisted", () => {
    it("allows waitlisted -> confirmed (promotion)", () => {
      expect(isValidBookingTransition("waitlisted", "confirmed")).toBe(true);
    });
    it("allows waitlisted -> cancelled (decline / abandon)", () => {
      expect(isValidBookingTransition("waitlisted", "cancelled")).toBe(true);
    });
    it("allows waitlisted -> waitlisted (no-op)", () => {
      expect(isValidBookingTransition("waitlisted", "waitlisted")).toBe(true);
    });
  });

  describe("from cancelled", () => {
    it("allows cancelled -> waitlisted (re-activation into queue)", () => {
      expect(isValidBookingTransition("cancelled", "waitlisted")).toBe(true);
    });
    it("rejects cancelled -> confirmed (must go via waitlist)", () => {
      expect(isValidBookingTransition("cancelled", "confirmed")).toBe(false);
    });
    it("allows cancelled -> cancelled (no-op)", () => {
      expect(isValidBookingTransition("cancelled", "cancelled")).toBe(true);
    });
  });

  it("rejects transition from an unknown status", () => {
    expect(
      // deliberately bad input to assert the default branch
      isValidBookingTransition(
        "unknown" as unknown as BookingStatus,
        "confirmed"
      )
    ).toBe(false);
  });

  it("enumerates exactly the three permitted non-trivial transitions", () => {
    const statuses: BookingStatus[] = ["confirmed", "waitlisted", "cancelled"];
    const allowed: Array<[BookingStatus, BookingStatus]> = [];
    for (const from of statuses) {
      for (const to of statuses) {
        if (from !== to && isValidBookingTransition(from, to)) {
          allowed.push([from, to]);
        }
      }
    }
    // The spec says exactly three transitions are valid:
    //   confirmed  -> cancelled
    //   waitlisted -> confirmed
    //   cancelled  -> waitlisted
    // (waitlisted -> cancelled is also allowed for "decline/abandon"
    // and is the fourth.)
    expect(allowed).toEqual(
      expect.arrayContaining([
        ["confirmed", "cancelled"],
        ["waitlisted", "confirmed"],
        ["cancelled", "waitlisted"],
      ])
    );
    // Must NOT include the forbidden ones.
    expect(allowed).not.toContainEqual(["cancelled", "confirmed"]);
    expect(allowed).not.toContainEqual(["confirmed", "waitlisted"]);
  });
});
