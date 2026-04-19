/**
 * Shift lifecycle helpers — the canonical definitions of "upcoming" /
 * "past" / "bookable" / "editable" that the whole app should share.
 *
 * These mirror the DB-side invariants enforced by the triggers in
 * `20260415000000_shift_lifecycle_rules.sql`. They are pure functions so
 * they can be unit-tested without a database and reused from every view
 * (admin / coordinator / volunteer / calendar).
 *
 * Timezone: shift end times are computed in the shift's local wall-clock
 * (America/Chicago for this project). Callers pass `now` as a Date — the
 * comparison happens in absolute UTC once both sides are Date objects.
 */

import type { Database } from "@/integrations/supabase/types";

export type ShiftStatus = Database["public"]["Enums"]["shift_status"];
export type ShiftTimeType = Database["public"]["Enums"]["shift_time_type"];

/**
 * Minimal shift shape the lifecycle helpers need. Every real shift row
 * from `public.shifts` satisfies this, so callers can pass rows directly.
 */
export interface ShiftLifecycleInput {
  shift_date: string;               // 'YYYY-MM-DD'
  start_time: string | null;        // 'HH:MM:SS' or null
  end_time: string | null;          // 'HH:MM:SS' or null
  time_type: ShiftTimeType | string;
  status: ShiftStatus | string;
}

/**
 * Default end-of-day times for shifts without an explicit end_time. These
 * mirror `public.shift_end_at()` in the baseline migration so the two
 * layers can never disagree.
 */
const DEFAULT_END_TIME: Record<string, string> = {
  morning: "12:00:00",
  afternoon: "16:00:00",
  all_day: "17:00:00",
};
const FALLBACK_END_TIME = "17:00:00";

/**
 * Computes the effective end timestamp for a shift as a Date, honoring
 * `time_type` defaults when `end_time` is null.
 */
export function shiftEndAt(shift: ShiftLifecycleInput): Date {
  const endStr =
    shift.end_time ||
    DEFAULT_END_TIME[shift.time_type] ||
    FALLBACK_END_TIME;
  return new Date(`${shift.shift_date}T${endStr}`);
}

/**
 * Upcoming = the shift's end time is still in the future.
 *
 * A shift is "past" the moment its end time elapses, regardless of its
 * current DB status. This is deliberately decoupled from status so the
 * UI never goes stale waiting for the every-15-min cron to flip the row
 * to 'completed'.
 */
export function isUpcoming(
  shift: ShiftLifecycleInput,
  now: Date = new Date()
): boolean {
  return shiftEndAt(shift) > now;
}

/** Past = not upcoming. */
export function isPast(
  shift: ShiftLifecycleInput,
  now: Date = new Date()
): boolean {
  return !isUpcoming(shift, now);
}

/**
 * Bookable iff the shift is in an active status AND its end time hasn't
 * passed. Cancelled + completed shifts are never bookable. This is the
 * client-side mirror of the DB triggers `enforce_shift_not_ended_on_booking`
 * and `block_bookings_on_completed_shifts`.
 */
export function isBookable(
  shift: ShiftLifecycleInput,
  now: Date = new Date()
): boolean {
  if (shift.status !== "open" && shift.status !== "full") return false;
  return isUpcoming(shift, now);
}

/**
 * Editable iff the shift has not been completed or cancelled. Matches the
 * `enforce_completed_shift_immutability` trigger (which blocks edits to
 * core scheduling fields once status='completed') and the existing
 * update_shift_status() trigger (which rejects status mutation on
 * cancelled/completed).
 */
export function isEditable(shift: ShiftLifecycleInput): boolean {
  return shift.status !== "completed" && shift.status !== "cancelled";
}

/**
 * Filters a list of shifts to only upcoming ones (end time in the future).
 * Use for "Upcoming" tabs across the app. Accepts the status filter as an
 * optional layer so callers can compose `upcoming AND status='open'`.
 */
export function filterUpcoming<T extends ShiftLifecycleInput>(
  shifts: T[],
  now: Date = new Date()
): T[] {
  return shifts.filter((s) => isUpcoming(s, now));
}

/** Filters a list of shifts to only past ones. */
export function filterPast<T extends ShiftLifecycleInput>(
  shifts: T[],
  now: Date = new Date()
): T[] {
  return shifts.filter((s) => isPast(s, now));
}
