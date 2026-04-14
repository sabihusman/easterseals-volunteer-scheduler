-- =============================================
-- Fix overbooking race (v2): also remove the redundant
-- shifts.booked_slots update from validate_booking_slot_count — that
-- update is already performed by sync_booked_slots AFTER INSERT, so
-- doing it here caused a double increment.
-- =============================================

CREATE OR REPLACE FUNCTION public.validate_booking_slot_count()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  actual_booked integer;
  max_slots integer;
BEGIN
  -- Lock the shift row first so concurrent bookings serialize.
  SELECT total_slots INTO max_slots
    FROM public.shifts
    WHERE id = NEW.shift_id
    FOR UPDATE;

  IF max_slots IS NULL THEN
    RETURN NEW;
  END IF;

  -- Count confirmed bookings (excluding this row if it's an UPDATE).
  SELECT COUNT(*) INTO actual_booked
    FROM public.shift_bookings
    WHERE shift_id = NEW.shift_id
      AND booking_status = 'confirmed'
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF actual_booked >= max_slots THEN
    -- Shift is full. Demote to waitlist instead of erroring so the
    -- volunteer gets a clean "you're on the waitlist" result.
    NEW.booking_status := 'waitlisted';
  END IF;

  -- sync_booked_slots (AFTER INSERT) handles incrementing shifts.booked_slots
  RETURN NEW;
END;
$function$;

-- Repair any already-drifted counters so existing shifts are clean.
UPDATE public.shifts s
SET booked_slots = sub.cnt
FROM (
  SELECT shift_id, COUNT(*) AS cnt
  FROM public.shift_bookings
  WHERE booking_status = 'confirmed'
  GROUP BY shift_id
) sub
WHERE s.id = sub.shift_id;

UPDATE public.shifts s
SET booked_slots = 0
WHERE NOT EXISTS (
  SELECT 1 FROM public.shift_bookings sb
  WHERE sb.shift_id = s.id AND sb.booking_status = 'confirmed'
);
