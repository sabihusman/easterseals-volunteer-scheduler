-- Audit 2026-04-28 (C2): Department Rollup row "Camp Sunnyside · 2
-- shifts · 0 confirmed · 0 no-shows · Fill: 0% · Attend: 100%" was
-- mathematically possible because `attendance_rate` uses the post-event
-- `confirmation_status` filter while the displayed `total_confirmed`
-- uses the pre-event `booking_status` filter. A booking marked
-- `confirmation_status='confirmed'` (attended) whose `booking_status`
-- later flipped to `'cancelled'` (admin removed shift, volunteer
-- retroactively cancelled, etc.) would fall out of total_confirmed
-- while still counting toward attendance_rate, producing the apparent
-- 0/0 → 100% paradox.
--
-- Two changes here:
--
--   1. Add `total_attended` to the function's return signature so the
--      UI can show the same denominator the percentage was computed
--      from. Reading "0 confirmed · 1 attended · 0 no-shows · 100%"
--      is internally consistent; the previous output omitted the
--      attended count.
--
--   2. Return `NULL` for `attendance_rate` when there's genuinely no
--      attendance data (zero attended AND zero no_shows), instead of
--      `0`. The frontend renders NULL as "—" so users don't read
--      "0%" as "everyone no-showed" when the truth is "no data yet."
--      Same change for `avg_fill_rate` when total_slots is zero.
--
-- Frontend reads `total_attended` and treats null rates as "—" — see
-- `src/pages/Reports.tsx` Department Rollup card and the
-- `summarize-reports` helper introduced in the same PR.
--
-- The function preserves its existing IS-A-COORDINATOR-OR-ADMIN guard
-- and SECURITY DEFINER setup; only the return signature and the rate
-- expressions change.
--
-- DROP first because CREATE OR REPLACE refuses to change the
-- RETURNS TABLE shape on an existing function (SQLSTATE 42P13). The
-- old signature didn't include `total_attended`; adding it counts as
-- changing the row type even though the argument list is unchanged.

DROP FUNCTION IF EXISTS "public"."get_department_report"("uuid"[], "date", "date");

CREATE OR REPLACE FUNCTION "public"."get_department_report"(
  "dept_uuids" "uuid"[],
  "date_from" "date",
  "date_to" "date"
) RETURNS TABLE(
  "department_id" "uuid",
  "department_name" "text",
  "total_shifts" integer,
  "total_confirmed" integer,
  "total_attended" integer,
  "total_no_shows" integer,
  "total_cancellations" integer,
  "total_waitlisted" integer,
  "avg_fill_rate" numeric,
  "attendance_rate" numeric,
  "rated_shift_count" integer,
  "avg_rating" numeric
)
LANGUAGE "plpgsql" STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_coordinator_or_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH shift_metrics AS (
    SELECT
      s.department_id,
      s.id AS sid,
      s.total_slots,
      COUNT(sb.id) FILTER (WHERE sb.booking_status = 'confirmed') AS confirmed,
      COUNT(sb.id) FILTER (WHERE sb.confirmation_status = 'confirmed') AS attended,
      COUNT(sb.id) FILTER (WHERE sb.confirmation_status = 'no_show') AS no_shows,
      COUNT(sb.id) FILTER (WHERE sb.booking_status = 'cancelled') AS cancelled,
      COUNT(sb.id) FILTER (WHERE sb.booking_status = 'waitlisted') AS waitlisted
    FROM public.shifts s
    LEFT JOIN public.shift_bookings sb ON sb.shift_id = s.id
    WHERE s.department_id = ANY(dept_uuids)
      AND s.shift_date BETWEEN date_from AND date_to
      AND s.status != 'cancelled'
    GROUP BY s.department_id, s.id, s.total_slots
  ),
  rating_metrics AS (
    SELECT
      s.department_id,
      s.id AS sid,
      AVG(vsr.star_rating) AS shift_avg,
      COUNT(vsr.star_rating) AS rating_n
    FROM public.shifts s
    JOIN public.shift_bookings sb ON sb.shift_id = s.id
    JOIN public.volunteer_shift_reports vsr ON vsr.booking_id = sb.id
    WHERE s.department_id = ANY(dept_uuids)
      AND s.shift_date BETWEEN date_from AND date_to
      AND s.status != 'cancelled'
      AND vsr.star_rating IS NOT NULL
    GROUP BY s.department_id, s.id
    HAVING COUNT(vsr.star_rating) >= 2
  )
  SELECT
    d.id,
    d.name,
    COUNT(DISTINCT sm.sid)::integer AS total_shifts,
    COALESCE(SUM(sm.confirmed), 0)::integer AS total_confirmed,
    COALESCE(SUM(sm.attended), 0)::integer AS total_attended,
    COALESCE(SUM(sm.no_shows), 0)::integer AS total_no_shows,
    COALESCE(SUM(sm.cancelled), 0)::integer AS total_cancellations,
    COALESCE(SUM(sm.waitlisted), 0)::integer AS total_waitlisted,
    -- avg_fill_rate: NULL when there are no slots in the window —
    -- distinguishes "no shifts published yet" from "shifts exist but
    -- nobody booked." Frontend renders NULL as "—".
    CASE WHEN SUM(sm.total_slots) > 0
      THEN ROUND((SUM(sm.confirmed)::numeric / SUM(sm.total_slots)::numeric) * 100, 2)
      ELSE NULL
    END AS avg_fill_rate,
    -- attendance_rate: NULL when there's no attendance signal at all
    -- (nobody attended, nobody no-showed). Previously this returned 0,
    -- which read identically to "everyone no-showed" — see audit C2.
    CASE WHEN (SUM(sm.attended) + SUM(sm.no_shows)) > 0
      THEN ROUND((SUM(sm.attended)::numeric / NULLIF((SUM(sm.attended) + SUM(sm.no_shows)), 0)::numeric) * 100, 2)
      ELSE NULL
    END AS attendance_rate,
    COUNT(DISTINCT rm.sid)::integer AS rated_shift_count,
    CASE WHEN COUNT(DISTINCT rm.sid) > 0
      THEN ROUND(AVG(rm.shift_avg)::numeric, 2)
      ELSE NULL
    END AS avg_rating
  FROM public.departments d
  LEFT JOIN shift_metrics sm ON sm.department_id = d.id
  LEFT JOIN rating_metrics rm ON rm.department_id = d.id
  WHERE d.id = ANY(dept_uuids)
  GROUP BY d.id, d.name;
END;
$$;

ALTER FUNCTION "public"."get_department_report"("dept_uuids" "uuid"[], "date_from" "date", "date_to" "date") OWNER TO "postgres";

GRANT ALL ON FUNCTION "public"."get_department_report"("dept_uuids" "uuid"[], "date_from" "date", "date_to" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."get_department_report"("dept_uuids" "uuid"[], "date_from" "date", "date_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_department_report"("dept_uuids" "uuid"[], "date_from" "date", "date_to" "date") TO "service_role";
