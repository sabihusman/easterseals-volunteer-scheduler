-- =============================================================================
-- Migration: shift_lifecycle_rules
-- Description: Establishes the canonical shift lifecycle enforcement layer.
--
-- Fixes the reported bug: past-dated shifts (Apr 9–17) with status 'open' or
-- 'full' are showing as "Upcoming" on the admin dashboard. No DB job exists
-- today that transitions shifts to 'completed' after their end time, and the
-- admin filter is status-based only. This migration fixes the DB side:
--
--   1. Adds transition_past_shifts_to_completed() — an idempotent RPC that
--      flips any 'open'/'full' shift whose end time has passed to 'completed'.
--      Returns the number of rows transitioned (useful for cron logs + tests).
--
--   2. Schedules the RPC on pg_cron every 15 minutes (if pg_cron is installed).
--      Named "shift-status-transition" to match the existing cron conventions
--      ("shift-reminder-*", "unactioned-shift-*", "reconcile-shift-counters").
--
--   3. Runs a one-time backfill in this migration so the Apr 9–17 shifts
--      stuck in 'open'/'full' are immediately transitioned. Safe because the
--      pre-existing update_shift_status() trigger already refuses to mutate
--      a row whose status is already 'completed', so this is idempotent.
--
--   4. Adds enforce_completed_shift_immutability() — BEFORE UPDATE trigger on
--      public.shifts. Once status = 'completed', the shift's core scheduling
--      fields (shift_date, start_time, end_time, time_type, department_id,
--      total_slots) cannot be edited. Coordinator notes, status (already
--      protected by update_shift_status), and updated_at are still mutable.
--
--   5. Adds block_bookings_on_completed_shifts() — BEFORE INSERT trigger on
--      public.shift_bookings. Rejects new bookings on completed shifts.
--      Complements the existing enforce_shift_not_ended_on_booking() which
--      is datetime-based; this one is status-based and acts as a defense-in-
--      depth when a shift is completed early by admin action or backfill.
--
--   6. Adds prevent_delete_bookings_on_completed_shifts() — BEFORE DELETE
--      trigger on public.shift_bookings. Once the parent shift is completed,
--      bookings are immutable audit records (soft-cancel still allowed via
--      UPDATE to booking_status = 'cancelled').
--
-- Timezone: pg_cron runs in UTC on Supabase, but the transition function
-- uses public.shift_end_at() which already converts to America/Chicago —
-- so "every 15 min UTC" ticks correctly regardless of DST.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Transition RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transition_past_shifts_to_completed()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $$
DECLARE
  v_count integer;
BEGIN
  WITH updated AS (
    UPDATE public.shifts s
       SET status = 'completed'
     WHERE s.status IN ('open', 'full')
       AND public.shift_end_at(s.shift_date, s.end_time, s.time_type::text) <= now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM updated;

  RETURN v_count;
END;
$$;

ALTER FUNCTION public.transition_past_shifts_to_completed() OWNER TO postgres;

-- Service role invokes this via the cron job; authenticated role has no
-- need for it but granting read parity matches the repo convention.
GRANT EXECUTE ON FUNCTION public.transition_past_shifts_to_completed() TO service_role;

COMMENT ON FUNCTION public.transition_past_shifts_to_completed() IS
  'Transitions open/full shifts whose end time has passed to completed. '
  'Idempotent. Scheduled every 15 min via pg_cron.';

-- ---------------------------------------------------------------------------
-- 2. pg_cron schedule (guarded — some envs don't have pg_cron)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Unschedule any prior version with the same name so this migration is
    -- re-runnable in local dev without "job already exists" errors.
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'shift-status-transition') THEN
      PERFORM cron.unschedule('shift-status-transition');
    END IF;

    PERFORM cron.schedule(
      'shift-status-transition',
      '*/15 * * * *',
      $cron$SELECT public.transition_past_shifts_to_completed();$cron$
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. One-time backfill for existing stuck shifts (Apr 9–17 etc.)
-- ---------------------------------------------------------------------------
SELECT public.transition_past_shifts_to_completed();

-- ---------------------------------------------------------------------------
-- 4. Completed-shift immutability trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_completed_shift_immutability()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_catalog
  AS $$
BEGIN
  -- Only enforce when the pre-update state was 'completed'. This lets the
  -- normal open → full → completed transition flow through unchanged.
  IF OLD.status <> 'completed' THEN
    RETURN NEW;
  END IF;

  -- Reject edits to the core scheduling fields once a shift is completed.
  -- Note: status itself is already protected by update_shift_status() which
  -- short-circuits on cancelled/completed.
  IF NEW.shift_date IS DISTINCT FROM OLD.shift_date THEN
    RAISE EXCEPTION 'Cannot edit shift_date on a completed shift'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.start_time IS DISTINCT FROM OLD.start_time THEN
    RAISE EXCEPTION 'Cannot edit start_time on a completed shift'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.end_time IS DISTINCT FROM OLD.end_time THEN
    RAISE EXCEPTION 'Cannot edit end_time on a completed shift'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.time_type IS DISTINCT FROM OLD.time_type THEN
    RAISE EXCEPTION 'Cannot edit time_type on a completed shift'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.total_slots IS DISTINCT FROM OLD.total_slots THEN
    RAISE EXCEPTION 'Cannot change total_slots on a completed shift'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    RAISE EXCEPTION 'Cannot reassign department_id on a completed shift'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_completed_shift_immutability() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_enforce_completed_shift_immutability
  ON public.shifts;

CREATE TRIGGER trg_enforce_completed_shift_immutability
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_completed_shift_immutability();

-- ---------------------------------------------------------------------------
-- 5. Block new bookings on completed shifts (status-based guard)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.block_bookings_on_completed_shifts()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_catalog
  AS $$
DECLARE
  v_status public.shift_status;
BEGIN
  -- Only relevant for active booking rows. Cancellations / waitlist offers
  -- following shift completion are permitted so existing rows can settle.
  IF NEW.booking_status NOT IN ('confirmed', 'waitlisted') THEN
    RETURN NEW;
  END IF;

  SELECT s.status INTO v_status
    FROM public.shifts s
   WHERE s.id = NEW.shift_id;

  IF v_status = 'completed' THEN
    RAISE EXCEPTION 'Cannot book a completed shift'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.block_bookings_on_completed_shifts() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_block_bookings_on_completed_shifts
  ON public.shift_bookings;

CREATE TRIGGER trg_block_bookings_on_completed_shifts
  BEFORE INSERT ON public.shift_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.block_bookings_on_completed_shifts();

-- ---------------------------------------------------------------------------
-- 6. Prevent deletion of bookings on completed shifts (audit trail)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_delete_bookings_on_completed_shifts()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_catalog
  AS $$
DECLARE
  v_status public.shift_status;
BEGIN
  SELECT s.status INTO v_status
    FROM public.shifts s
   WHERE s.id = OLD.shift_id;

  IF v_status = 'completed' THEN
    RAISE EXCEPTION 'Cannot delete bookings on a completed shift (audit trail)'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN OLD;
END;
$$;

ALTER FUNCTION public.prevent_delete_bookings_on_completed_shifts() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_prevent_delete_bookings_on_completed_shifts
  ON public.shift_bookings;

CREATE TRIGGER trg_prevent_delete_bookings_on_completed_shifts
  BEFORE DELETE ON public.shift_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_delete_bookings_on_completed_shifts();

COMMIT;
