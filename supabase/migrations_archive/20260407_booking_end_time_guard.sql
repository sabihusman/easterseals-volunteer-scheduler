-- =============================================
-- Server-side guard: refuse to create or re-confirm a shift_booking
-- whose underlying shift has already ended. Prevents stale browser
-- state from inserting bookings for past shifts.
--
-- Uses shift_end_at() helper (created earlier in unactioned-shifts
-- migration) to compute the end timestamp honoring time_type defaults.
-- =============================================

CREATE OR REPLACE FUNCTION public.enforce_shift_not_ended_on_booking()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_end timestamptz;
  v_time_type text;
  v_shift_date date;
  v_end_time time;
BEGIN
  -- Only block active bookings; cancellations are fine
  IF NEW.booking_status NOT IN ('confirmed', 'waitlisted') THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, only re-check if the transition is into an active state
  -- (i.e. the user is re-activating a cancelled booking).
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

DROP TRIGGER IF EXISTS trg_enforce_shift_not_ended_insert ON public.shift_bookings;
CREATE TRIGGER trg_enforce_shift_not_ended_insert
  BEFORE INSERT ON public.shift_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_shift_not_ended_on_booking();

DROP TRIGGER IF EXISTS trg_enforce_shift_not_ended_update ON public.shift_bookings;
CREATE TRIGGER trg_enforce_shift_not_ended_update
  BEFORE UPDATE ON public.shift_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_shift_not_ended_on_booking();
