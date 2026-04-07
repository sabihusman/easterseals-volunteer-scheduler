-- =============================================
-- Clarify the intent of enforce_shift_not_ended_on_booking.
-- The previous comment was misleading ("only re-check if..." when
-- the code actually skips the re-check for active-to-active updates).
-- No logic change.
-- =============================================
CREATE OR REPLACE FUNCTION public.enforce_shift_not_ended_on_booking()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_end timestamptz;
  v_time_type text;
  v_shift_date date;
  v_end_time time;
BEGIN
  -- Allow cancellations and other non-active transitions through unconditionally
  IF NEW.booking_status NOT IN ('confirmed', 'waitlisted') THEN
    RETURN NEW;
  END IF;

  -- Active -> active updates (e.g. admin_action_off_shift which only
  -- changes confirmation_status) are exempt. Re-validating end time on
  -- these would incorrectly block legitimate flows for shifts that have
  -- already ended.
  IF TG_OP = 'UPDATE'
     AND OLD.booking_status IN ('confirmed', 'waitlisted')
     AND NEW.booking_status IN ('confirmed', 'waitlisted') THEN
    RETURN NEW;
  END IF;

  SELECT s.shift_date, s.end_time, s.time_type::text
    INTO v_shift_date, v_end_time, v_time_type
    FROM public.shifts s
   WHERE s.id = NEW.shift_id;

  IF v_shift_date IS NULL THEN
    RETURN NEW;
  END IF;

  v_end := public.shift_end_at(v_shift_date, v_end_time, v_time_type);

  IF v_end <= now() THEN
    RAISE EXCEPTION 'Cannot book a shift that has already ended'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;
