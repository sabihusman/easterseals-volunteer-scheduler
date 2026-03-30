import { describe, it, expect } from "vitest";
import { formatSlotTime, formatSlotRange, slotHours, previewSlotCount } from "../slot-utils";

describe("formatSlotTime", () => {
  it("formats morning time", () => {
    expect(formatSlotTime("08:00")).toBe("8:00 AM");
  });
  it("formats afternoon time", () => {
    expect(formatSlotTime("14:30")).toBe("2:30 PM");
  });
  it("formats midnight as 12:00 AM", () => {
    expect(formatSlotTime("00:00")).toBe("12:00 AM");
  });
  it("formats noon as 12:00 PM", () => {
    expect(formatSlotTime("12:00")).toBe("12:00 PM");
  });
  it("handles HH:MM:SS format", () => {
    expect(formatSlotTime("09:15:00")).toBe("9:15 AM");
  });
});

describe("formatSlotRange", () => {
  it("formats a range", () => {
    expect(formatSlotRange("08:00", "10:00")).toBe("8:00 AM – 10:00 AM");
  });
  it("formats cross-period range", () => {
    expect(formatSlotRange("10:00", "14:00")).toBe("10:00 AM – 2:00 PM");
  });
});

describe("slotHours", () => {
  it("returns 2 for a standard 2-hour slot", () => {
    expect(slotHours("08:00", "10:00")).toBe(2);
  });
  it("returns 1.5 for a 90-minute slot", () => {
    expect(slotHours("08:00", "09:30")).toBe(1.5);
  });
  it("returns 0 for same start and end", () => {
    expect(slotHours("08:00", "08:00")).toBe(0);
  });
});

describe("previewSlotCount – 2-hour chunk generation", () => {
  it("returns 4 for an 8-hour shift", () => {
    expect(previewSlotCount("08:00", "16:00")).toBe(4);
  });
  it("returns 3 for a 5-hour shift (ceil)", () => {
    expect(previewSlotCount("08:00", "13:00")).toBe(3);
  });
  it("returns 1 for a 1-hour shift (partial slot)", () => {
    expect(previewSlotCount("08:00", "09:00")).toBe(1);
  });
  it("returns 0 for invalid range", () => {
    expect(previewSlotCount("16:00", "08:00")).toBe(0);
  });
  it("returns 0 for same start and end", () => {
    expect(previewSlotCount("08:00", "08:00")).toBe(0);
  });
});
