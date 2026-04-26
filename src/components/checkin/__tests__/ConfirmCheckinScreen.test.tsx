import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * Tier 3 test for ConfirmCheckinScreen.
 *
 * Pure presentational. Tests cover:
 *   - Single-shift mode (no "Check In to All" button)
 *   - Multi-shift mode (per-shift cards + "Check In to All")
 *   - Both callback wirings
 */

import { ConfirmCheckinScreen } from "@/components/checkin/ConfirmCheckinScreen";
import type { MatchedShift } from "@/lib/checkin-actions";

const onCheckIn = vi.fn();
const onCheckInAll = vi.fn();

const baseShift: MatchedShift = {
  bookingId: "booking-1",
  shiftId: "shift-1",
  title: "Morning Grounds Crew",
  shiftDate: "2026-05-01",
  startTime: "09:00",
  endTime: "12:00",
  departmentName: "Grounds",
  timeSlotId: null,
  slotStart: null,
  slotEnd: null,
};

const secondShift: MatchedShift = {
  ...baseShift,
  bookingId: "booking-2",
  shiftId: "shift-2",
  title: "Afternoon Adult Day",
  startTime: "13:00",
  endTime: "16:00",
  departmentName: "Adult Day Services",
};

beforeEach(() => {
  onCheckIn.mockReset();
  onCheckInAll.mockReset();
});

describe("ConfirmCheckinScreen", () => {
  it("renders one card per shift and the 'Check In to All' button when there are 2+ shifts", () => {
    render(
      <ConfirmCheckinScreen
        volunteerName="Alex"
        shifts={[baseShift, secondShift]}
        onCheckIn={onCheckIn}
        onCheckInAll={onCheckInAll}
      />
    );
    expect(screen.getByText(baseShift.title)).toBeInTheDocument();
    expect(screen.getByText(secondShift.title)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /check in to all 2 slots/i })).toBeInTheDocument();
  });

  it("does NOT render the 'Check In to All' button with a single shift", () => {
    render(
      <ConfirmCheckinScreen
        volunteerName="Alex"
        shifts={[baseShift]}
        onCheckIn={onCheckIn}
        onCheckInAll={onCheckInAll}
      />
    );
    expect(screen.getByText(baseShift.title)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /check in to all/i })).not.toBeInTheDocument();
  });

  it("invokes onCheckIn with the clicked shift", () => {
    render(
      <ConfirmCheckinScreen
        volunteerName="Alex"
        shifts={[baseShift, secondShift]}
        onCheckIn={onCheckIn}
        onCheckInAll={onCheckInAll}
      />
    );
    // The shift cards are <button> elements wrapping the shift content; click
    // by visible title.
    fireEvent.click(screen.getByText(secondShift.title).closest("button")!);
    expect(onCheckIn).toHaveBeenCalledTimes(1);
    expect(onCheckIn).toHaveBeenCalledWith(secondShift);
  });

  it("invokes onCheckInAll when the multi-slot button is clicked", () => {
    render(
      <ConfirmCheckinScreen
        volunteerName="Alex"
        shifts={[baseShift, secondShift]}
        onCheckIn={onCheckIn}
        onCheckInAll={onCheckInAll}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /check in to all 2 slots/i }));
    expect(onCheckInAll).toHaveBeenCalledTimes(1);
  });
});
