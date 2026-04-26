import { supabase } from "@/integrations/supabase/client";
import { isWithinPostShiftGrace } from "./shift-time";

/**
 * Service-layer functions for the QR check-in flow.
 *
 * The functions are exposed individually rather than wrapped into a single
 * "do the whole flow" helper so the page can preserve the explicit
 * sensitive-ops sequence:
 *
 *   1. validateCheckinToken
 *   2. (session check happens at page level)
 *   3. login (only if needed) — stays inside LoginForm because it's the
 *      second half of the auth transaction
 *   4. fetchTodaysMatchedShifts
 *   5. recordCheckin (per shift)
 *   6. notifyCoordinatorsOfCheckin
 *
 * No React, no toast, no useState. Page handlers translate results into
 * step transitions + UI feedback.
 */

export interface MatchedShift {
  bookingId: string;
  shiftId: string;
  title: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  departmentName: string;
  timeSlotId: string | null;
  slotStart: string | null;
  slotEnd: string | null;
}

const POST_SHIFT_GRACE_MINUTES = 30;

/** Validate the QR token via the `validate_checkin_token` RPC. */
export async function validateCheckinToken(token: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("validate_checkin_token", { p_token: token });
  if (error) return false;
  return Boolean(data);
}

/**
 * Resolve a username (no `@`) to its email via the `get_email_by_username` RPC.
 * Returns null if not found. Email-as-identifier short-circuits — the caller
 * decides whether to call this based on whether the input contains `@`.
 */
export async function resolveLoginIdentifierToEmail(identifier: string): Promise<string | null> {
  const { data } = await supabase.rpc("get_email_by_username", { p_username: identifier });
  return (data as string | null) ?? null;
}

export type ShiftMatchResult =
  | { kind: "no_shift"; volunteerName: string }
  | { kind: "already"; volunteerName: string }
  | { kind: "matched"; volunteerName: string; shifts: MatchedShift[] };

interface BookingRow {
  id: string;
  shift_id: string;
  checked_in: boolean | null;
  checked_in_at: string | null;
  time_slot_id: string | null;
  shifts: {
    id: string;
    title: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    departments: { name: string } | null;
  } | null;
}

/**
 * Fetch today's confirmed bookings for the volunteer, fetch slot times for
 * any slot-bookings, filter out shifts that ended more than 30 minutes ago,
 * and return a discriminated-union result.
 *
 * Boundary cast applied once at the supabase response. Coordinator
 * notification is a separate function.
 */
export async function fetchTodaysMatchedShifts(userId: string, currentTime: string): Promise<ShiftMatchResult> {
  // Volunteer name first — used in every downstream UI screen.
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .single();
  const volunteerName = profile?.full_name || "Volunteer";

  const today = new Date().toISOString().split("T")[0];

  const { data } = await supabase
    .from("shift_bookings")
    .select(`
      id,
      shift_id,
      checked_in,
      checked_in_at,
      time_slot_id,
      shifts!inner(
        id, title, shift_date, start_time, end_time,
        departments(name)
      )
    `)
    .eq("volunteer_id", userId)
    .eq("booking_status", "confirmed")
    .eq("shifts.shift_date", today);

  const bookings = ((data as any[]) || []) as BookingRow[];

  if (bookings.length === 0) {
    return { kind: "no_shift", volunteerName };
  }

  // All-already-checked-in short-circuit.
  const unchecked = bookings.filter((b) => !b.checked_in && !b.checked_in_at);
  if (unchecked.length === 0) {
    return { kind: "already", volunteerName };
  }

  const matched: MatchedShift[] = [];
  for (const b of unchecked) {
    const s = b.shifts;
    if (!s) continue;
    let slotStart: string | null = null;
    let slotEnd: string | null = null;

    if (b.time_slot_id) {
      const { data: slot } = await supabase
        .from("shift_time_slots")
        .select("slot_start, slot_end")
        .eq("id", b.time_slot_id)
        .single();
      if (slot) {
        slotStart = slot.slot_start;
        slotEnd = slot.slot_end;
      }
    }

    // Apply post-shift 30-min grace filter — drop shifts that ended more
    // than 30 minutes ago.
    const effectiveEnd = slotEnd || s.end_time;
    if (effectiveEnd && !isWithinPostShiftGrace(effectiveEnd, currentTime, POST_SHIFT_GRACE_MINUTES)) {
      continue;
    }

    matched.push({
      bookingId: b.id,
      shiftId: s.id,
      title: s.title,
      shiftDate: s.shift_date,
      startTime: (slotStart || s.start_time)?.slice(0, 5),
      endTime: (slotEnd || s.end_time)?.slice(0, 5),
      departmentName: s.departments?.name || "Unknown",
      timeSlotId: b.time_slot_id,
      slotStart,
      slotEnd,
    });
  }

  if (matched.length === 0) {
    return { kind: "no_shift", volunteerName };
  }

  return { kind: "matched", volunteerName, shifts: matched };
}

/** Mark one booking as checked in. */
export async function recordCheckin(bookingId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("shift_bookings")
    .update({
      checked_in: true,
      checked_in_at: new Date().toISOString(),
    })
    .eq("id", bookingId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

interface NotifyArgs {
  shiftId: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Fan-out coordinator notifications for a check-in. Looks up the shift's
 * department, fetches all coordinators for that department, inserts one
 * notification per coordinator. Failures don't throw — caller can ignore.
 */
export async function notifyCoordinatorsOfCheckin({ shiftId, title, message, data }: NotifyArgs): Promise<void> {
  const { data: shiftInfo } = await supabase
    .from("shifts")
    .select("department_id")
    .eq("id", shiftId)
    .single();
  if (!shiftInfo) return;

  const { data: coords } = await supabase
    .from("department_coordinators")
    .select("coordinator_id")
    .eq("department_id", shiftInfo.department_id);

  const coordRows = ((coords as { coordinator_id: string }[] | null) || []);
  if (coordRows.length === 0) return;

  const notifications = coordRows.map((c) => ({
    user_id: c.coordinator_id,
    type: "volunteer_checked_in",
    title,
    message,
    link: "/coordinator",
    ...(data ? { data } : {}),
  }));
  await supabase.from("notifications").insert(notifications as never);
}
