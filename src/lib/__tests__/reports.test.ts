import { describe, it, expect } from "vitest";
import {
  formatRate,
  formatRating,
  summarizeReports,
  type ShiftRollupInput,
} from "@/lib/reports";

const blank: ShiftRollupInput = {
  totalSlots: 0,
  confirmedCount: 0,
  attended: 0,
  noShows: 0,
};

describe("summarizeReports", () => {
  it("returns null rates when there is no data at all (audit C2)", () => {
    // The brief's specific test requirement: zero bookings + zero
    // attendance must NOT produce a 100% (or 0%) attendance figure.
    const result = summarizeReports([]);

    expect(result.fillRate).toBeNull();
    expect(result.attendRate).toBeNull();
    expect(result.avgRating).toBeNull();
    expect(result.ratedCount).toBe(0);
    expect(result.totalShifts).toBe(0);
  });

  it("returns null attendRate when shifts exist but nobody attended/no-showed yet", () => {
    // The reported anomaly's shape: bookings exist but the post-event
    // attendance signal is empty (no shifts have ended, or the
    // bookings were retroactively cancelled out).
    const result = summarizeReports([
      { ...blank, totalSlots: 5, confirmedCount: 3 },
      { ...blank, totalSlots: 5, confirmedCount: 0 },
    ]);

    // Fill rate has data: 3 confirmed / 10 slots = 30%
    expect(result.fillRate).toBe(30);
    // Attendance rate has no data: render "—" not "0%" or "100%"
    expect(result.attendRate).toBeNull();
  });

  it("returns null fillRate when there are no slots even if attendance data exists", () => {
    // Inverse anomaly: orphaned attendance records for shifts whose
    // total_slots somehow rolled to 0 (deletion, schema migration).
    const result = summarizeReports([
      { ...blank, totalSlots: 0, attended: 1, noShows: 0 },
    ]);

    expect(result.fillRate).toBeNull();
    expect(result.attendRate).toBe(100);
  });

  it("computes both rates when data is present", () => {
    const result = summarizeReports([
      { ...blank, totalSlots: 10, confirmedCount: 8, attended: 6, noShows: 2 },
      { ...blank, totalSlots: 10, confirmedCount: 5, attended: 4, noShows: 1 },
    ]);

    // Fill: 13 / 20 = 65%
    expect(result.fillRate).toBe(65);
    // Attend: 10 / (10+3) = 76.9... rounds to 77
    expect(result.attendRate).toBe(77);
  });

  it("avgRating ignores unrated shifts (avoids 0★ on no-data)", () => {
    const result = summarizeReports([
      { ...blank, totalSlots: 1, ratingAvg: 4.5 },
      { ...blank, totalSlots: 1, ratingAvg: 3.5 },
      { ...blank, totalSlots: 1 }, // unrated
    ]);

    expect(result.avgRating).toBe(4.0);
    expect(result.ratedCount).toBe(2);
  });

  it("avgRating is null when no shifts have ratings", () => {
    const result = summarizeReports([
      { ...blank, totalSlots: 1 },
      { ...blank, totalSlots: 1 },
    ]);

    expect(result.avgRating).toBeNull();
    expect(result.ratedCount).toBe(0);
  });

  it("totalShifts is the input length, regardless of whether they have data", () => {
    const result = summarizeReports([blank, blank, blank]);
    expect(result.totalShifts).toBe(3);
  });
});

describe("formatRate", () => {
  it("renders null as em-dash", () => {
    expect(formatRate(null)).toBe("—");
  });
  it("renders 0 as 0% (a real value, not no-data)", () => {
    expect(formatRate(0)).toBe("0%");
  });
  it("renders 100 as 100%", () => {
    expect(formatRate(100)).toBe("100%");
  });
  it("renders intermediate values with % suffix", () => {
    expect(formatRate(42)).toBe("42%");
  });
});

describe("formatRating", () => {
  it("renders null as em-dash", () => {
    expect(formatRating(null)).toBe("—");
  });
  it("renders a numeric rating without suffix", () => {
    expect(formatRating(4.5)).toBe("4.5");
  });
});
