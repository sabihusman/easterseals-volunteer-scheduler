-- =============================================
-- CRITICAL FIX: shift creation is broken for all clients in
-- production. The 20260408_p1_p2_p3_hardening migration added a
-- restrictive RLS policy "shift_time_slots: deny client insert"
-- (WITH CHECK false) to lock the slot counter table down, but it
-- did NOT update the trigger function generate_shift_time_slots to
-- SECURITY DEFINER. The trigger therefore runs in the caller's auth
-- context, hits the deny policy, and 403s back to the client.
--
-- Symptom: any user (coordinator, admin, E2E test) trying to INSERT
-- into shifts via PostgREST gets:
--   {"code":"42501","message":"new row violates row-level security
--    policy \"shift_time_slots: deny client insert\" for table
--    \"shift_time_slots\""}
--
-- Fix: recreate the trigger function as SECURITY DEFINER with an
-- explicit search_path. SECURITY DEFINER lets the function bypass
-- RLS on shift_time_slots when it cascades from a shift insert,
-- which is the intended behavior — slot generation is an internal
-- system operation, not a user action.
--
-- This is the same pattern already used by sync_booked_slots and
-- has_active_booking_on (see the recursion-fix migration).
-- =============================================

CREATE OR REPLACE FUNCTION public.generate_shift_time_slots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- Short shifts (≤4 h) get a single time slot.
  IF duration_hours <= 4 THEN
    INSERT INTO public.shift_time_slots (shift_id, slot_start, slot_end, total_slots)
    VALUES (NEW.id, NEW.start_time, NEW.end_time, NEW.total_slots);
    RETURN NEW;
  END IF;

  -- Longer shifts split into 2-hour chunks.
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
