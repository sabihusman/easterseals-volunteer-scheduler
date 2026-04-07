-- =============================================
-- Reports tab: helper functions for coordinator/admin reports
-- =============================================

-- Shift popularity score per shift (factors in waitlist + interactions)
-- Returns aggregated metrics for each shift in the requested set.
-- Coordinator/admin only.
CREATE OR REPLACE FUNCTION public.get_shift_popularity(shift_uuids uuid[])
RETURNS TABLE (
  shift_id uuid,
  confirmed_count integer,
  waitlist_count integer,
  view_count integer,
  fill_ratio numeric,
  popularity_score numeric
) LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
BEGIN
  IF NOT public.is_coordinator_or_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH shift_data AS (
    SELECT
      s.id,
      s.total_slots,
      COALESCE(SUM(CASE WHEN sb.booking_status = 'confirmed' THEN 1 ELSE 0 END), 0)::integer AS confirmed,
      COALESCE(SUM(CASE WHEN sb.booking_status = 'waitlisted' THEN 1 ELSE 0 END), 0)::integer AS waitlisted
    FROM public.shifts s
    LEFT JOIN public.shift_bookings sb ON sb.shift_id = s.id
    WHERE s.id = ANY(shift_uuids)
    GROUP BY s.id, s.total_slots
  ),
  view_data AS (
    SELECT vsi.shift_id, COUNT(*)::integer AS views
    FROM public.volunteer_shift_interactions vsi
    WHERE vsi.shift_id = ANY(shift_uuids)
      AND vsi.interaction_type = 'viewed'
    GROUP BY vsi.shift_id
  )
  SELECT
    sd.id,
    sd.confirmed,
    sd.waitlisted,
    COALESCE(vd.views, 0),
    CASE WHEN sd.total_slots > 0 THEN ROUND((sd.confirmed::numeric / sd.total_slots::numeric), 2) ELSE 0 END,
    -- Popularity score: fill rate (0-1) + waitlist demand bonus (0.1 per waitlist) + view normalized (cap 1.0)
    -- Formula prioritizes shifts that fill up AND have waitlists
    ROUND(
      (CASE WHEN sd.total_slots > 0 THEN (sd.confirmed::numeric / sd.total_slots::numeric) ELSE 0 END
        + (sd.waitlisted * 0.1)
        + LEAST(COALESCE(vd.views, 0)::numeric / 20.0, 1.0) * 0.2
      )::numeric,
      2
    )
  FROM shift_data sd
  LEFT JOIN view_data vd ON vd.shift_id = sd.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_shift_popularity(uuid[]) TO authenticated;

-- Shift consistency report: % of confirmed bookings that resulted in
-- "confirmed" attendance (vs no_show or cancelled). Returns per-shift metrics.
CREATE OR REPLACE FUNCTION public.get_shift_consistency(shift_uuids uuid[])
RETURNS TABLE (
  shift_id uuid,
  total_bookings integer,
  attended integer,
  no_shows integer,
  cancelled integer,
  attendance_rate numeric
) LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
BEGIN
  IF NOT public.is_coordinator_or_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    sb.shift_id,
    COUNT(*)::integer AS total_bookings,
    COUNT(*) FILTER (WHERE sb.confirmation_status = 'confirmed')::integer AS attended,
    COUNT(*) FILTER (WHERE sb.confirmation_status = 'no_show')::integer AS no_shows,
    COUNT(*) FILTER (WHERE sb.booking_status = 'cancelled')::integer AS cancelled,
    CASE WHEN COUNT(*) FILTER (WHERE sb.booking_status IN ('confirmed', 'cancelled')) > 0
      THEN ROUND(
        (COUNT(*) FILTER (WHERE sb.confirmation_status = 'confirmed')::numeric
         / NULLIF(COUNT(*) FILTER (WHERE sb.booking_status IN ('confirmed', 'cancelled')), 0)::numeric)
        * 100, 2)
      ELSE 0
    END AS attendance_rate
  FROM public.shift_bookings sb
  WHERE sb.shift_id = ANY(shift_uuids)
  GROUP BY sb.shift_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_shift_consistency(uuid[]) TO authenticated;

-- Department-level rollup: aggregate metrics across all shifts in a department
-- over a date range. Coordinator/admin only.
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
      AND vsr.star_rating IS NOT NULL
    GROUP BY s.department_id, s.id
    HAVING COUNT(vsr.star_rating) >= 2  -- Privacy: 2+ ratings minimum
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

GRANT EXECUTE ON FUNCTION public.get_department_report(uuid[], date, date) TO authenticated;
