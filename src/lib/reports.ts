/**
 * Pure helpers for the coordinator/admin Reports page summary cards.
 *
 * Pulled out of `src/pages/Reports.tsx` so the audit-driven test cases
 * (audit 2026-04-28 C2) can pin the math without rendering the whole
 * page. The two anomalies the audit cared about are:
 *
 *   - Zero attendance signal must NOT produce 100% (or 0%); it must
 *     produce "no data" so the UI can render "—".
 *   - Fill rate is independent of attendance rate; insufficient data
 *     for one must not blank out the other.
 *
 * `null` vs `0` is the load-bearing distinction. Frontend renders
 * `null` as "—" (no data), `0` as "0%" (real bottom).
 */

export interface ShiftRollupInput {
  /** total_slots on the shift row */
  totalSlots: number;
  /** popularity.confirmed_count for fill computation */
  confirmedCount: number;
  /** consistency.attended (post-event finalized) */
  attended: number;
  /** consistency.no_shows (post-event finalized) */
  noShows: number;
  /** Optional rating aggregate for this shift; undefined = unrated */
  ratingAvg?: number;
}

export interface ReportsSummary {
  totalShifts: number;
  /** null = no slots in the visible set (nothing published) */
  fillRate: number | null;
  /** null = no attendance signal at all (nobody attended, nobody no-showed) */
  attendRate: number | null;
  /** null = no rated shifts (avoids "0★" when truth is "no data") */
  avgRating: number | null;
  ratedCount: number;
}

/**
 * Aggregate per-shift consistency/popularity numbers into the summary
 * the top-of-page stat cards display. Returns null for any rate that
 * doesn't have a meaningful denominator — see comment above.
 */
export function summarizeReports(shifts: ShiftRollupInput[]): ReportsSummary {
  const totalShifts = shifts.length;

  let totalConfirmed = 0;
  let totalAttended = 0;
  let totalNoShows = 0;
  let totalSlots = 0;
  let ratingSum = 0;
  let ratedCount = 0;

  for (const s of shifts) {
    totalConfirmed += s.confirmedCount;
    totalAttended += s.attended;
    totalNoShows += s.noShows;
    totalSlots += s.totalSlots;
    if (typeof s.ratingAvg === "number") {
      ratingSum += s.ratingAvg;
      ratedCount += 1;
    }
  }

  const fillRate =
    totalSlots > 0
      ? Math.round((totalConfirmed / totalSlots) * 100)
      : null;

  const attendDenom = totalAttended + totalNoShows;
  const attendRate =
    attendDenom > 0
      ? Math.round((totalAttended / attendDenom) * 100)
      : null;

  const avgRating =
    ratedCount > 0
      ? +(ratingSum / ratedCount).toFixed(1)
      : null;

  return { totalShifts, fillRate, attendRate, avgRating, ratedCount };
}

/**
 * Format a percentage rate for display. `null` (no data) renders as
 * an em-dash; finite numbers render with the `%` suffix. Used by both
 * the top stat cards and the Department Rollup card so "no data" is
 * visually consistent across the page.
 */
export function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${rate}%`;
}

/** Same shape as formatRate but for the avg-rating star figure. */
export function formatRating(rating: number | null): string {
  return rating === null ? "—" : `${rating}`;
}
