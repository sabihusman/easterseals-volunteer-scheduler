-- =============================================
-- Require emergency contact before booking.
--
-- Easterseals works with vulnerable populations — insurance/liability
-- requires every active volunteer to have emergency contacts on file.
--
-- The enforce_booking_window trigger already runs BEFORE INSERT on
-- shift_bookings and has access to the volunteer's profile. Adding
-- the check here (rather than a separate trigger) keeps the
-- validation in one place and avoids an extra profile lookup.
-- =============================================

CREATE OR REPLACE FUNCTION public.enforce_booking_window()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  shift_rec  record;
  max_days   int;
  vol        public.profiles%rowtype;
BEGIN
  SELECT * INTO vol FROM public.profiles WHERE id = NEW.volunteer_id;

  -- ── Emergency contact gate ──
  -- Both name and phone must be present before a volunteer can book.
  IF vol.emergency_contact_name IS NULL OR TRIM(vol.emergency_contact_name) = '' THEN
    RAISE EXCEPTION 'Emergency contact required. Please add an emergency contact name in your profile settings before booking a shift.';
  END IF;
  IF vol.emergency_contact_phone IS NULL OR TRIM(vol.emergency_contact_phone) = '' THEN
    RAISE EXCEPTION 'Emergency contact required. Please add an emergency contact phone number in your profile settings before booking a shift.';
  END IF;

  SELECT s.shift_date, s.start_time, s.end_time, s.requires_bg_check,
         d.requires_bg_check AS dept_bg_check
  INTO shift_rec
  FROM public.shifts s
  JOIN public.departments d ON d.id = s.department_id
  WHERE s.id = NEW.shift_id;

  -- Background check enforcement
  IF shift_rec.requires_bg_check OR shift_rec.dept_bg_check THEN
    IF vol.bg_check_status != 'cleared' THEN
      RAISE EXCEPTION 'This shift requires a cleared background check. Your current status is: %', vol.bg_check_status;
    END IF;
    IF vol.bg_check_expires_at IS NOT NULL AND vol.bg_check_expires_at < now() THEN
      RAISE EXCEPTION 'Your background check has expired. Please renew before booking this shift.';
    END IF;
  END IF;

  -- Booking window enforcement
  max_days := CASE WHEN vol.extended_booking THEN 21 ELSE 14 END;
  IF (shift_rec.shift_date - current_date) > max_days THEN
    RAISE EXCEPTION 'Booking window exceeded. You can book up to % days in advance.', max_days;
  END IF;
  IF shift_rec.shift_date < current_date THEN
    RAISE EXCEPTION 'Cannot book a shift in the past.';
  END IF;

  RETURN NEW;
END;
$function$;
