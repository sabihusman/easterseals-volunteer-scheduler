-- =============================================
-- Re-apply the double-increment fix for validate_booking_slot_count.
-- The previous v2 migration appears to have been reverted or
-- overwritten; the function is back to counting then also doing
-- `UPDATE shifts SET booked_slots = actual_booked + 1` — but the
-- AFTER INSERT trigger sync_booked_slots ALSO increments, so every
-- new booking increments twice.
--
-- Correct behavior:
--   1. Lock the shifts row with FOR UPDATE
--   2. Count existing confirmed (excluding the row being touched)
--   3. If at capacity, demote to waitlist
--   4. Do NOT update shifts.booked_slots here — the AFTER trigger
--      sync_booked_slots handles it on INSERT, and on waitlist-to-
--      confirmed update, sync_booked_slots handles that transition
--      too.
-- =============================================

CREATE OR REPLACE FUNCTION public.validate_booking_slot_count()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  actual_booked integer;
  max_slots integer;
BEGIN
  -- Lock the shift row first so concurrent bookings serialize through
  -- this point.
  SELECT total_slots INTO max_slots
    FROM public.shifts
    WHERE id = NEW.shift_id
    FOR UPDATE;

  IF max_slots IS NULL THEN
    RETURN NEW;
  END IF;

  -- Count confirmed bookings *after* acquiring the lock (excluding the
  -- row being updated/inserted, so a waitlisted->confirmed update on the
  -- same row doesn't double-count itself).
  SELECT COUNT(*) INTO actual_booked
    FROM public.shift_bookings
    WHERE shift_id = NEW.shift_id
      AND booking_status = 'confirmed'
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF actual_booked >= max_slots THEN
    -- Shift is full. Demote to waitlist instead of raising.
    NEW.booking_status := 'waitlisted';
  END IF;

  -- sync_booked_slots (AFTER INSERT / AFTER UPDATE OF booking_status)
  -- handles the shifts.booked_slots counter — DO NOT update it here.

  RETURN NEW;
END;
$function$;

-- Re-sync the counter in case previous double-increments have drifted it
UPDATE public.shifts s SET booked_slots = sub.cnt
FROM (
  SELECT shift_id, COUNT(*) AS cnt
  FROM public.shift_bookings
  WHERE booking_status = 'confirmed'
  GROUP BY shift_id
) sub WHERE s.id = sub.shift_id;

UPDATE public.shifts s SET booked_slots = 0
WHERE NOT EXISTS (
  SELECT 1 FROM public.shift_bookings sb
  WHERE sb.shift_id = s.id AND sb.booking_status = 'confirmed'
);

NOTIFY pgrst, 'reload schema';
