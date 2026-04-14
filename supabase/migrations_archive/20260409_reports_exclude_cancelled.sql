-- =============================================
-- Fix: get_department_report includes cancelled shifts in totals.
-- The per-shift view in Reports.tsx filters `.neq("status", "cancelled")`
-- but the department-level rollup RPC did not apply the same filter,
-- causing the department totals to diverge from the sum of individual
-- shift metrics shown on the same page.
--
-- Fix: add `AND s.status != 'cancelled'` to both CTEs in
-- get_department_report so cancelled shifts are excluded from
-- totals, fill rate, attendance rate, and ratings.
-- =============================================

CREATE OR REPLACE FUNCTION public.get_department_report(
  dept_uuids uuid[],
  date_from date,
  date_to date
)
RETURNS TABLE (
  department_id uuid,
  department_name text,
  total_shifts integer,
  total_confirmed integer,
  total_no_shows integer,
  total_cancellations integer,
  total_waitlisted integer,
  avg_fill_rate numeric,
  attendance_rate numeric,
  rated_shift_count integer,
  avg_rating numeric
) LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
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
    COALESCE(SUM(sm.no_shows), 0)::integer AS total_no_shows,
    COALESCE(SUM(sm.cancelled), 0)::integer AS total_cancellations,
    COALESCE(SUM(sm.waitlisted), 0)::integer AS total_waitlisted,
    CASE WHEN SUM(sm.total_slots) > 0
      THEN ROUND((SUM(sm.confirmed)::numeric / SUM(sm.total_slots)::numeric) * 100, 2)
      ELSE 0
    END AS avg_fill_rate,
    CASE WHEN (SUM(sm.attended) + SUM(sm.no_shows)) > 0
      THEN ROUND((SUM(sm.attended)::numeric / NULLIF((SUM(sm.attended) + SUM(sm.no_shows)), 0)::numeric) * 100, 2)
      ELSE 0
    END AS attendance_rate,
    COUNT(DISTINCT rm.sid)::integer AS rated_shift_count,
    CASE WHEN COUNT(DISTINCT rm.sid) > 0
      THEN ROUND(AVG(rm.shift_avg)::numeric, 2)
      ELSE 0
    END AS avg_rating
  FROM public.departments d
  LEFT JOIN shift_metrics sm ON sm.department_id = d.id
  LEFT JOIN rating_metrics rm ON rm.department_id = d.id
  WHERE d.id = ANY(dept_uuids)
  GROUP BY d.id, d.name;
END;
$$;
