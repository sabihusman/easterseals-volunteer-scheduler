-- =============================================
-- Slot count hardening:
-- 1. Clamp sync_slot_booked_count so it can never cause the
--    shift_time_slots.chk_slot_slots check to fail. Previously a
--    stray double-insert or duplicate decrement could push booked_slots
--    above total_slots or below 0, surfacing as an unrelated error
--    (e.g. during action-off if any re-evaluation triggered).
-- 2. Harden generate_shift_time_slots to skip if total_slots <= 0.
-- 3. One-time resync: recompute shift_time_slots.booked_slots from
--    the actual shift_booking_slots rows for confirmed bookings so
--    any drifted state is corrected.
-- =============================================

CREATE OR REPLACE FUNCTION public.sync_slot_booked_count()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_total integer;
  v_current integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT total_slots, booked_slots INTO v_total, v_current
      FROM public.shift_time_slots
      WHERE id = NEW.slot_id
      FOR UPDATE;
    UPDATE public.shift_time_slots
      SET booked_slots = LEAST(v_current + 1, v_total)
      WHERE id = NEW.slot_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.shift_time_slots
      SET booked_slots = GREATEST(booked_slots - 1, 0)
      WHERE id = OLD.slot_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_shift_time_slots()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  slot_start time;
  slot_end   time;
  duration_hours numeric;
BEGIN
  IF NEW.start_time IS NULL OR NEW.end_time IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.end_time <= NEW.start_time THEN
    RETURN NEW;
  END IF;
  IF NEW.total_slots IS NULL OR NEW.total_slots <= 0 THEN
    RETURN NEW;
  END IF;

  duration_hours := EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 3600.0;

  IF duration_hours <= 4 THEN
    INSERT INTO public.shift_time_slots (shift_id, slot_start, slot_end, total_slots)
    VALUES (NEW.id, NEW.start_time, NEW.end_time, NEW.total_slots);
    RETURN NEW;
  END IF;

  slot_start := NEW.start_time;
  WHILE slot_start < NEW.end_time LOOP
    slot_end := LEAST(slot_start + interval '2 hours', NEW.end_time);
    INSERT INTO public.shift_time_slots (shift_id, slot_start, slot_end, total_slots)
    VALUES (NEW.id, slot_start, slot_end, NEW.total_slots);
    slot_start := slot_end;
  END LOOP;
  RETURN NEW;
END;
$function$;

-- ══════════════════════════════════════
-- One-time resync: recompute shift_time_slots.booked_slots
-- from ground truth. Only counts active bookings.
-- Clamps to total_slots so the check constraint can never trip.
-- ══════════════════════════════════════
UPDATE public.shift_time_slots sts
SET booked_slots = LEAST(counts.cnt, sts.total_slots)
FROM (
  SELECT sbs.slot_id, COUNT(*) AS cnt
  FROM public.shift_booking_slots sbs
  JOIN public.shift_bookings sb ON sb.id = sbs.booking_id
  WHERE sb.booking_status = 'confirmed'
  GROUP BY sbs.slot_id
) counts
WHERE sts.id = counts.slot_id;

-- Slots with no matching active bookings → booked_slots = 0
UPDATE public.shift_time_slots sts
SET booked_slots = 0
WHERE NOT EXISTS (
  SELECT 1 FROM public.shift_booking_slots sbs
  JOIN public.shift_bookings sb ON sb.id = sbs.booking_id
  WHERE sbs.slot_id = sts.id AND sb.booking_status = 'confirmed'
);

-- Also resync shifts.booked_slots from the actual confirmed count
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
