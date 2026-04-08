-- =============================================
-- RPC: admin / coordinator retroactive hour correction
-- Updates final_hours on a confirmed booking and recalculates the
-- volunteer's total_hours + volunteer_points.
-- =============================================

CREATE OR REPLACE FUNCTION public.admin_update_shift_hours(
  p_booking_id uuid,
  p_hours numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_volunteer_id uuid;
  v_shift_id uuid;
  v_max_hours numeric;
  v_start time;
  v_end   time;
  v_time_type text;
BEGIN
  IF NOT public.is_coordinator_or_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_hours IS NULL OR p_hours < 0 THEN
    RAISE EXCEPTION 'hours must be 0 or greater';
  END IF;

  SELECT sb.volunteer_id, sb.shift_id
    INTO v_volunteer_id, v_shift_id
    FROM public.shift_bookings sb
    WHERE sb.id = p_booking_id;

  IF v_volunteer_id IS NULL THEN
    RAISE EXCEPTION 'booking not found';
  END IF;

  -- Cap at shift duration + 30 minutes early-checkin grace
  SELECT s.start_time, s.end_time, s.time_type::text
    INTO v_start, v_end, v_time_type
    FROM public.shifts s
    WHERE s.id = v_shift_id;

  v_max_hours := CASE
    WHEN v_start IS NOT NULL AND v_end IS NOT NULL
      THEN EXTRACT(EPOCH FROM (v_end - v_start)) / 3600.0
    WHEN v_time_type IN ('morning', 'afternoon') THEN 4
    ELSE 8
  END + 0.5;  -- 30 min grace for early check-in

  IF p_hours > v_max_hours THEN
    RAISE EXCEPTION 'hours cannot exceed shift duration (max %)', v_max_hours;
  END IF;

  -- Update the booking
  UPDATE public.shift_bookings
  SET final_hours = p_hours,
      coordinator_reported_hours = p_hours,
      hours_source = 'coordinator',
      updated_at = now()
  WHERE id = p_booking_id;

  -- Recompute profiles.total_hours for this volunteer
  UPDATE public.profiles
  SET total_hours = (
    SELECT COALESCE(SUM(final_hours), 0)
    FROM public.shift_bookings
    WHERE volunteer_id = v_volunteer_id
      AND confirmation_status = 'confirmed'
      AND final_hours IS NOT NULL
  ),
  updated_at = now()
  WHERE id = v_volunteer_id;

  -- Recompute volunteer_points (reads final_hours we just wrote)
  PERFORM public.recalculate_points(v_volunteer_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_shift_hours(uuid, numeric) TO authenticated;
