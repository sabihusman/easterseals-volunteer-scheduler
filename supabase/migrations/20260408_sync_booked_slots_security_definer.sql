-- =============================================
-- ROOT CAUSE of Bug #12: the sync_booked_slots trigger tried to
-- UPDATE public.shifts SET booked_slots = booked_slots + 1, but the
-- shifts UPDATE RLS policy "shifts: coord/admin update" only allows
-- coordinators and admins. When a VOLUNTEER books a shift via
-- PostgREST, the trigger runs in the volunteer's role context, RLS
-- silently rejects the UPDATE, zero rows change, and booked_slots
-- stays at its old value. No error is raised.
--
-- Fix: mark the trigger function SECURITY DEFINER so it bypasses
-- RLS on the UPDATE. Also remove the trace NOTICEs I added earlier.
-- =============================================

CREATE OR REPLACE FUNCTION public.sync_booked_slots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.booking_status = 'confirmed' THEN
    UPDATE public.shifts
      SET booked_slots = booked_slots + 1
      WHERE id = NEW.shift_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.booking_status = 'confirmed' AND NEW.booking_status = 'cancelled' THEN
      UPDATE public.shifts
        SET booked_slots = GREATEST(booked_slots - 1, 0)
        WHERE id = NEW.shift_id;
    ELSIF OLD.booking_status IN ('waitlisted', 'cancelled')
          AND NEW.booking_status = 'confirmed' THEN
      UPDATE public.shifts
        SET booked_slots = booked_slots + 1
        WHERE id = NEW.shift_id;
    ELSIF OLD.booking_status = 'confirmed' AND NEW.booking_status = 'waitlisted' THEN
      UPDATE public.shifts
        SET booked_slots = GREATEST(booked_slots - 1, 0)
        WHERE id = NEW.shift_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Same issue affects sync_slot_booked_count for shift_time_slots.
-- shift_time_slots has NO UPDATE policy at all, so RLS flat-out
-- blocks any UPDATE from authenticated users. Mark that one
-- SECURITY DEFINER too.
CREATE OR REPLACE FUNCTION public.sync_slot_booked_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- One-time resync after the fix
SELECT public.reconcile_shift_counters();
