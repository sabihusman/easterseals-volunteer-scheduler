-- =============================================
-- Fix: the prevent_overlapping_bookings trigger fires on both
-- INSERT and UPDATE. When a volunteer confirms their attendance
-- (updating confirmation_status or final_hours on an existing
-- booking), the trigger re-runs the overlap check and rejects
-- the update if another booking exists at the same time — even
-- though the booking was already created and the volunteer
-- legitimately attended the shift.
--
-- Fix: skip the overlap check on UPDATEs where booking_status
-- hasn't changed. The overlap check is only meaningful when:
--   - A new booking is created (INSERT)
--   - A cancelled booking is reactivated (UPDATE with
--     booking_status changing from 'cancelled' to something else)
--
-- Metadata updates (confirmation_status, final_hours, checked_in_at)
-- should never trigger the overlap check.
-- =============================================

CREATE OR REPLACE FUNCTION public.prevent_overlapping_bookings()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  new_start time;
  new_end   time;
  overlap_count int;
  new_date  date;
BEGIN
  -- On UPDATE, only check overlaps if booking_status changed
  -- (e.g. cancelled → confirmed reactivation). Skip for metadata
  -- updates like confirmation_status, final_hours, checked_in_at.
  IF TG_OP = 'UPDATE' AND OLD.booking_status = NEW.booking_status THEN
    RETURN NEW;
  END IF;

  -- Get the new shift's date and time
  SELECT s.shift_date, s.start_time, s.end_time
  INTO new_date, new_start, new_end
  FROM public.shifts s
  WHERE s.id = NEW.shift_id;

  -- Only check if shift has explicit times
  IF new_start IS NULL OR new_end IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check for any confirmed bookings on same date that overlap
  SELECT COUNT(*) INTO overlap_count
  FROM public.shift_bookings sb
  JOIN public.shifts s ON s.id = sb.shift_id
  WHERE sb.volunteer_id = NEW.volunteer_id
    AND sb.booking_status = 'confirmed'
    AND sb.id != NEW.id
    AND s.shift_date = new_date
    AND s.start_time < new_end
    AND s.end_time > new_start;

  IF overlap_count > 0 THEN
    RAISE EXCEPTION 'You already have a booking that overlaps with this shift time.';
  END IF;

  RETURN NEW;
END;
$function$;
