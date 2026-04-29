import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for cancelShiftWithNotifications — the helper behind
 * ManageShifts (coordinator) and AdminDashboard (admin) cancel flows.
 *
 * The load-bearing assertions are the audit-fix correctness ones:
 *   1. .update().select() returning [] is treated as "not_allowed",
 *      NOT as success. Pre-fix, this surfaced as "Shift deleted" on
 *      a no-op (RLS denial).
 *   2. Notification rows are inserted with sms_eligible derived from
 *      the isUrgent flag, so the webhook can decide whether to invoke
 *      Twilio without re-deriving the 24h check itself.
 *   3. Optional reason flows through unchanged (null when blank).
 */

interface SbResponse<T> {
  data: T;
  error: { message: string } | null;
}

// Per-test mocks. We rebuild a tiny fluent client that records every
// call, so the test can assert on shape without coupling to the
// supabase-js internals. The from() table name selects which mock chain
// gets returned — keeping tables independent makes the assertions
// compose cleanly across the helper's three writes (shifts.update,
// shift_bookings.update, notifications.insert).
let shiftsUpdateResponse: SbResponse<Array<{ id: string }> | null>;
let bookingsSelectResponse: SbResponse<Array<{ id: string; volunteer_id: string }>>;
let notificationsInsertCalls: unknown[][];
let bookingsUpdateCalls: unknown[][];
let shiftsUpdateCalls: unknown[][];

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      from(table: string) {
        if (table === "shift_bookings") {
          return {
            select() {
              return {
                eq() {
                  return {
                    eq: () => Promise.resolve(bookingsSelectResponse),
                  };
                },
              };
            },
            update(payload: unknown) {
              bookingsUpdateCalls.push([payload]);
              return {
                eq() {
                  return {
                    eq: () => Promise.resolve({ data: null, error: null }),
                  };
                },
              };
            },
          };
        }
        if (table === "shifts") {
          return {
            update(payload: unknown) {
              shiftsUpdateCalls.push([payload]);
              return {
                eq() {
                  return {
                    select: () => Promise.resolve(shiftsUpdateResponse),
                  };
                },
              };
            },
          };
        }
        if (table === "notifications") {
          return {
            insert(rows: unknown) {
              notificationsInsertCalls.push([rows]);
              return Promise.resolve({ data: null, error: null });
            },
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    },
  };
});

import { cancelShiftWithNotifications } from "@/lib/shift-cancel";

const baseShift = {
  id: "shift-1",
  title: "Test Shift",
  shift_date: "2099-01-15",
  start_time: "10:00:00",
  end_time: "12:00:00",
  department_id: "dept-1",
  departments: { name: "Test Department" },
};

beforeEach(() => {
  shiftsUpdateResponse = { data: [{ id: "shift-1" }], error: null };
  bookingsSelectResponse = { data: [], error: null };
  notificationsInsertCalls = [];
  bookingsUpdateCalls = [];
  shiftsUpdateCalls = [];
});

describe("cancelShiftWithNotifications", () => {
  it("returns ok when the update affects one row and no volunteers are booked", async () => {
    bookingsSelectResponse = { data: [], error: null };
    shiftsUpdateResponse = { data: [{ id: "shift-1" }], error: null };

    const result = await cancelShiftWithNotifications({
      shift: baseShift,
      reason: null,
      isUrgent: false,
      shiftDateFormatted: "Jan 15, 2099",
      shiftTimeLabel: "Custom · 10:00 AM – 12:00 PM",
    });

    expect(result).toEqual({ ok: true, notifiedCount: 0 });
    expect(shiftsUpdateCalls).toHaveLength(1);
    expect(shiftsUpdateCalls[0][0]).toEqual({ status: "cancelled" });
    // No bookings → no booking-cancel and no notification fan-out.
    expect(bookingsUpdateCalls).toHaveLength(0);
    expect(notificationsInsertCalls).toHaveLength(0);
  });

  it("returns not_allowed when the update returns zero rows (RLS denial)", async () => {
    // This is the audit fix: pre-PR, the .update() call had no
    // .select(), so the helper saw error: null and returned ok.
    // Now an empty response array means RLS filtered the row out and
    // we MUST surface that as a destructive outcome.
    shiftsUpdateResponse = { data: [], error: null };

    const result = await cancelShiftWithNotifications({
      shift: baseShift,
      reason: null,
      isUrgent: false,
      shiftDateFormatted: "Jan 15, 2099",
      shiftTimeLabel: "Custom · 10:00 AM – 12:00 PM",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("not_allowed");
      expect(result.message).toMatch(/permission/i);
    }
    expect(notificationsInsertCalls).toHaveLength(0);
    expect(bookingsUpdateCalls).toHaveLength(0);
  });

  it("returns error when the update itself fails (network/server error)", async () => {
    shiftsUpdateResponse = { data: null, error: { message: "boom" } };

    const result = await cancelShiftWithNotifications({
      shift: baseShift,
      reason: null,
      isUrgent: false,
      shiftDateFormatted: "Jan 15, 2099",
      shiftTimeLabel: "Custom · 10:00 AM – 12:00 PM",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("error");
      expect(result.message).toBe("boom");
    }
  });

  it("notifies each booked volunteer with sms_eligible derived from isUrgent", async () => {
    bookingsSelectResponse = {
      data: [
        { id: "b1", volunteer_id: "v1" },
        { id: "b2", volunteer_id: "v2" },
      ],
      error: null,
    };

    const result = await cancelShiftWithNotifications({
      shift: baseShift,
      reason: "Weather closure",
      isUrgent: true, // <24h
      shiftDateFormatted: "Jan 15, 2099",
      shiftTimeLabel: "Custom · 10:00 AM – 12:00 PM",
    });

    expect(result).toEqual({ ok: true, notifiedCount: 2 });
    expect(notificationsInsertCalls).toHaveLength(1);
    const rows = notificationsInsertCalls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.type).toBe("shift_cancelled");
      expect(row.title).toBe("Shift Cancelled — Test Shift");
      const data = row.data as Record<string, unknown>;
      expect(data.sms_eligible).toBe(true);
      expect(data.cancellation_reason).toBe("Weather closure");
      expect(data.shift_id).toBe("shift-1");
      expect(data.shift_time).toBe("Custom · 10:00 AM – 12:00 PM");
      expect(data.department).toBe("Test Department");
    }
  });

  it("sets sms_eligible=false on long-lead cancellations (>24h)", async () => {
    bookingsSelectResponse = {
      data: [{ id: "b1", volunteer_id: "v1" }],
      error: null,
    };

    await cancelShiftWithNotifications({
      shift: baseShift,
      reason: null,
      isUrgent: false, // 24h+
      shiftDateFormatted: "Jan 15, 2099",
      shiftTimeLabel: "Custom · 10:00 AM – 12:00 PM",
    });

    const rows = notificationsInsertCalls[0][0] as Array<Record<string, unknown>>;
    expect((rows[0].data as Record<string, unknown>).sms_eligible).toBe(false);
  });

  it("omits cancellation_reason from data when reason is blank", async () => {
    bookingsSelectResponse = {
      data: [{ id: "b1", volunteer_id: "v1" }],
      error: null,
    };

    await cancelShiftWithNotifications({
      shift: baseShift,
      reason: null,
      isUrgent: true,
      shiftDateFormatted: "Jan 15, 2099",
      shiftTimeLabel: "Custom · 10:00 AM – 12:00 PM",
    });

    const rows = notificationsInsertCalls[0][0] as Array<Record<string, unknown>>;
    const data = rows[0].data as Record<string, unknown>;
    expect(data.cancellation_reason).toBeNull();
    // Message should NOT include "Reason: " when reason is blank.
    expect(rows[0].message).not.toMatch(/Reason:/i);
  });

  it("includes the reason in the message body when provided", async () => {
    bookingsSelectResponse = {
      data: [{ id: "b1", volunteer_id: "v1" }],
      error: null,
    };

    await cancelShiftWithNotifications({
      shift: baseShift,
      reason: "Bus broke down",
      isUrgent: true,
      shiftDateFormatted: "Jan 15, 2099",
      shiftTimeLabel: "Custom · 10:00 AM – 12:00 PM",
    });

    const rows = notificationsInsertCalls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0].message).toContain("Reason: Bus broke down");
  });
});
