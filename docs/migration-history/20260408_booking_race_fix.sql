-- =============================================
-- Fix overbooking race: the previous validate_booking_slot_count
-- counted shift_bookings BEFORE locking the shifts row, so two
-- concurrent INSERTs could both see 0 of 1 slots taken and both
-- succeed, leaving the shift at 2/1.
--
-- Fix:
--   1. Lock the shifts row FOR UPDATE first (serializes all concurrent
--      booking attempts for that shift).
--   2. Only then count existing confirmed bookings.
--   3. If full, auto-demote the new booking to 'waitlisted' instead
--      of raising, so the client gets a clean result and the volunteer
--      lands on the waitlist instead of seeing an error.
-- =============================================

CREATE OR REPLACE FUNCTION public.validate_booking_slot_count()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  actual_booked integer;
  max_slots integer;
BEGIN
  -- Lock the shift row first so concurrent bookings for the same shift
  -- serialize through this point.
  SELECT total_slots INTO max_slots
    FROM public.shifts
    WHERE id = NEW.shift_id
    FOR UPDATE;

  IF max_slots IS NULL THEN
    RETURN NEW;
  END IF;

  -- Count confirmed bookings *after* acquiring the lock, so a concurrent
  -- transaction that's already inserted will be visible.
  SELECT COUNT(*) INTO actual_booked
    FROM public.shift_bookings
    WHERE shift_id = NEW.shift_id
      AND booking_status = 'confirmed'
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF actual_booked >= max_slots THEN
    -- Shift is full. Demote to waitlist instead of erroring.
    NEW.booking_status := 'waitlisted';
    RETURN NEW;
  END IF;

  UPDATE public.shifts SET booked_slots = actual_booked + 1 WHERE id = NEW.shift_id;
  RETURN NEW;
END;
$function$;
