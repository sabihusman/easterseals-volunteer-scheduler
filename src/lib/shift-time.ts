/**
 * Time-window helpers for shift booking and check-in flows.
 *
 * The legacy data model lets `start_time` / `end_time` be NULL when the shift
 * uses a preset `time_type` ("morning" / "afternoon" / "full_day" / "custom").
 * Two places in VolunteerDashboard had bit-equivalent default-resolution logic
 * (handleCheckIn around line 463 and the upcoming-shifts JSX around line 801);
 * this module is the single source of truth.
 *
 * Defaults preserved verbatim from the original sites:
 *   morning  → 09:00–12:00
 *   afternoon → 13:00–16:00
 *   anything else (including full_day / custom with NULL bounds) → 09:00–17:00
 */

export interface ShiftTimeInput {
  shift_date: string;
  start_time: string | null;
  end_time: string | null;
  time_type: string | null;
}

/** Returns the effective start/end Date for a shift, applying time_type defaults. */
export function getEffectiveTimes(shift: ShiftTimeInput): { start: Date; end: Date } {
  const startStr =
    shift.start_time ||
    (shift.time_type === "morning"
      ? "09:00:00"
      : shift.time_type === "afternoon"
      ? "13:00:00"
      : "09:00:00");
  const endStr =
    shift.end_time ||
    (shift.time_type === "morning"
      ? "12:00:00"
      : shift.time_type === "afternoon"
      ? "16:00:00"
      : "17:00:00");
  return {
    start: new Date(`${shift.shift_date}T${startStr}`),
    end: new Date(`${shift.shift_date}T${endStr}`),
  };
}

/**
 * Whether check-in is open for a shift right now. Window is
 * [start − 30 min, end] inclusive.
 */
export function isCheckInOpen(shift: ShiftTimeInput, now: Date = new Date()): boolean {
  const { start, end } = getEffectiveTimes(shift);
  const nowMs = now.getTime();
  return nowMs >= start.getTime() - 30 * 60 * 1000 && nowMs <= end.getTime();
}

/** Minutes from `now` until the shift starts. Negative if the shift has already started. */
export function minutesUntilStart(shift: ShiftTimeInput, now: Date = new Date()): number {
  const { start } = getEffectiveTimes(shift);
  return (start.getTime() - now.getTime()) / 60000;
}
