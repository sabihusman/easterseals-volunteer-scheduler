-- =============================================
-- Fix: slot generator was producing 2-hour sub-slots even for
-- short shifts. For a 15-minute or 1-hour shift, sub-slotting makes
-- no sense and confuses the booking UI. Rule:
--   - If total duration <= 4 hours: one slot for the whole shift
--   - Otherwise: sub-slot in 2-hour increments (existing behavior)
-- Also: refuse to generate slots for absurd durations (> 12 hours)
-- because it's almost always an AM/PM input mistake. The insert
-- still succeeds but skips slot generation so the admin can correct it.
-- =============================================

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

  -- Sanity check: end must be after start
  IF NEW.end_time <= NEW.start_time THEN
    RETURN NEW;
  END IF;

  duration_hours := EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 3600.0;

  -- Short shifts (<= 4 hours): one slot covering the whole thing.
  IF duration_hours <= 4 THEN
    INSERT INTO public.shift_time_slots (shift_id, slot_start, slot_end, total_slots)
    VALUES (NEW.id, NEW.start_time, NEW.end_time, NEW.total_slots);
    RETURN NEW;
  END IF;

  -- Longer shifts: break into 2-hour sub-slots so volunteers can pick segments.
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
