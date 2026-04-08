-- =============================================
-- THE REAL ROOT CAUSE of Bug #12 (definitive fix):
--
-- validate_booking_slot_count runs as the authenticated caller. Its
-- SELECT COUNT(*) FROM shift_bookings WHERE ... booking_status='confirmed'
-- is subject to RLS. The shift_bookings SELECT policies for volunteers
-- only show the volunteer's OWN rows (`volunteer_id = auth.uid()`),
-- so when Volunteer B inserts a booking on a shift that Volunteer A
-- has already filled, the count returns 0 (Vol B has no prior rows),
-- and the function does NOT demote NEW.booking_status to 'waitlisted'.
--
-- The INSERT then proceeds with booking_status='confirmed', and the
-- AFTER INSERT trigger sync_booked_slots increments shifts.booked_slots
-- past total_slots \u2014 triggering the chk_slots CHECK constraint violation.
--
-- Previous fixes I shipped (making sync_booked_slots SECURITY DEFINER,
-- removing the double-increment, adding cancelled->confirmed branch)
-- were all correct and necessary but none of them addressed this
-- underlying RLS invisibility issue.
--
-- The fix: mark validate_booking_slot_count SECURITY DEFINER so its
-- count query bypasses RLS and sees ALL confirmed bookings on the shift.
-- =============================================

CREATE OR REPLACE FUNCTION public.validate_booking_slot_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  actual_booked integer;
  max_slots integer;
BEGIN
  SELECT total_slots INTO max_slots
    FROM public.shifts
    WHERE id = NEW.shift_id
    FOR UPDATE;

  IF max_slots IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO actual_booked
    FROM public.shift_bookings
    WHERE shift_id = NEW.shift_id
      AND booking_status = 'confirmed'
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF actual_booked >= max_slots THEN
    NEW.booking_status := 'waitlisted';
  END IF;

  RETURN NEW;
END;
$function$;

-- Also run the reconcile in case any bad state is in the DB
SELECT public.reconcile_shift_counters();
