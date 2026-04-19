-- =============================================
-- Fix: get_shift_consistency total_bookings should match the
-- denominator used for attendance_rate (confirmed + cancelled),
-- so that displayed "attended / total_bookings" is consistent
-- with the displayed "attendance_rate".
-- =============================================
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
    COUNT(*) FILTER (WHERE sb.booking_status IN ('confirmed', 'cancelled'))::integer AS total_bookings,
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
