-- =============================================
-- Dynamic waitlist offer expiry window.
--
-- Previously the offer was always now() + 2 hours regardless of when
-- the shift starts. A volunteer could receive a 2-hour acceptance
-- window for a shift that starts in 45 minutes — by the time they
-- accept, it's already begun.
--
-- New logic:
--   1. Compute shift_start from shifts.shift_date + shifts.start_time
--      (using time_type defaults when start_time is null, same as
--      shift_end_at but for the start).
--   2. If the shift starts within 30 minutes, skip promotion entirely.
--      There isn't enough time for the volunteer to see the offer,
--      accept, and actually show up.
--   3. Otherwise, set the expiry to the SOONER of:
--        - now() + 2 hours  (the standard window)
--        - shift_start - 30 minutes  (must accept 30 min before start)
--   4. The notification message dynamically reflects the actual
--      window ("You have X hours/minutes to respond").
--
-- Also adds a helper function shift_start_at() for consistency with
-- the existing shift_end_at().
-- =============================================

-- Helper: compute the start timestamp for a shift (mirrors shift_end_at).
CREATE OR REPLACE FUNCTION public.shift_start_at(
  p_shift_date date,
  p_start_time time WITHOUT TIME ZONE,
  p_time_type text
)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT (
    (p_shift_date::text || ' ' || COALESCE(
      p_start_time::text,
      CASE p_time_type
        WHEN 'morning'   THEN '09:00:00'
        WHEN 'afternoon' THEN '13:00:00'
        WHEN 'all_day'   THEN '09:00:00'
        ELSE '09:00:00'
      END
    ))::timestamp AT TIME ZONE 'America/Chicago'
  );
$function$;

-- Recreate promote_next_waitlist with dynamic expiry.
CREATE OR REPLACE FUNCTION public.promote_next_waitlist(p_shift_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_booking_id    uuid;
  v_volunteer_id  uuid;
  v_shift_title   text;
  v_shift_date    date;
  v_shift_status  text;
  v_shift_end     timestamptz;
  v_shift_start   timestamptz;
  v_expires_at    timestamptz;
  v_window_minutes int;
  v_window_label  text;
BEGIN
  -- Fetch shift metadata.
  SELECT s.title, s.shift_date, s.status::text,
         public.shift_end_at(s.shift_date, s.end_time, s.time_type::text),
         public.shift_start_at(s.shift_date, s.start_time, s.time_type::text)
    INTO v_shift_title, v_shift_date, v_shift_status, v_shift_end, v_shift_start
    FROM public.shifts s
    WHERE s.id = p_shift_id;

  -- Basic guards.
  IF v_shift_title IS NULL THEN
    RETURN NULL; -- shift deleted
  END IF;
  IF v_shift_status = 'cancelled' THEN
    RETURN NULL;
  END IF;
  IF v_shift_end <= now() THEN
    RETURN NULL; -- shift already ended
  END IF;

  -- If the shift starts within 30 minutes, skip promotion entirely.
  -- Not enough time for the volunteer to see the offer and show up.
  IF v_shift_start <= now() + interval '30 minutes' THEN
    RETURN NULL;
  END IF;

  -- Find the next eligible waitlisted volunteer.
  SELECT sb.id, sb.volunteer_id
    INTO v_booking_id, v_volunteer_id
    FROM public.shift_bookings sb
    WHERE sb.shift_id = p_shift_id
      AND sb.booking_status = 'waitlisted'
      AND (sb.waitlist_offer_expires_at IS NULL
           OR sb.waitlist_offer_expires_at < now())
    ORDER BY sb.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

  IF v_booking_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Dynamic expiry: the sooner of 2 hours or 30 minutes before start.
  v_expires_at := LEAST(
    now() + interval '2 hours',
    v_shift_start - interval '30 minutes'
  );

  -- Compute a human-readable window label for the notification.
  v_window_minutes := GREATEST(1, EXTRACT(EPOCH FROM (v_expires_at - now()))::int / 60);
  IF v_window_minutes >= 120 THEN
    v_window_label := '2 hours';
  ELSIF v_window_minutes >= 60 THEN
    v_window_label := '1 hour ' || (v_window_minutes - 60) || ' minutes';
  ELSE
    v_window_label := v_window_minutes || ' minutes';
  END IF;

  -- Set the offer.
  UPDATE public.shift_bookings
  SET waitlist_offer_expires_at = v_expires_at,
      updated_at = now()
  WHERE id = v_booking_id;

  -- Notify the volunteer.
  INSERT INTO public.notifications (user_id, type, title, message, data, link, is_read)
  VALUES (
    v_volunteer_id,
    'waitlist_offer',
    'A spot just opened: ' || v_shift_title,
    'You have ' || v_window_label || ' to confirm or decline this shift. ' ||
      'The offer expires at ' ||
      to_char(v_expires_at AT TIME ZONE 'America/Chicago', 'HH12:MI AM Mon DD') || '.',
    jsonb_build_object(
      'booking_id',    v_booking_id,
      'shift_id',      p_shift_id,
      'shift_title',   v_shift_title,
      'shift_date',    v_shift_date,
      'expires_at',    v_expires_at,
      'window_minutes', v_window_minutes,
      'shift_start',   v_shift_start
    ),
    '/dashboard',
    false
  );

  RETURN v_booking_id;
END;
$function$;
