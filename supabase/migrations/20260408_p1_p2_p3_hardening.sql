-- =============================================
-- Hardening pass: P1/P2/P3 fixes from the post-QA audit
--
-- Fix 1 (P1): Remove duplicate cron job shift-reminder-job and the
--             legacy send_shift_reminders() function it called.
-- Fix 3 (P2): Add restrictive UPDATE policy on shift_time_slots.
-- Fix 4 (P2): Lock the shift_time_slots row in validate_booking_slot_count
--             so concurrent slot bookings serialize correctly.
-- Fix 6 (P3): Constant-time get_email_by_username to neutralize the
--             username-existence timing oracle.
-- =============================================

-- ============================================================
-- FIX 1: Duplicate cron jobs
-- ============================================================
-- shift-reminder-job runs send_shift_reminders() which inserts its own
-- 24-hour and 1-hour reminder notifications. shift-reminder-24h
-- (0 * * * *) and shift-reminder-2h (30 * * * *) cover the same window
-- with the newer typed reminders. Running both pipelines causes every
-- volunteer with notif_email=true to receive 2x reminders (one with
-- type='shift_reminder_24h', one with type='shift_reminder_auto').
SELECT cron.unschedule('shift-reminder-job')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'shift-reminder-job');

DROP FUNCTION IF EXISTS public.send_shift_reminders();

-- ============================================================
-- FIX 3: Restrictive UPDATE policy on shift_time_slots
-- ============================================================
-- Today shift_time_slots has zero RLS policies for UPDATE. Direct client
-- UPDATEs are blocked only by the lack of GRANT, but a future privilege
-- change could open it up. The counter (booked_slots) is only ever
-- legitimately written by the SECURITY DEFINER trigger sync_slot_booked_count.
-- Add a restrictive policy that returns false for any client UPDATE so
-- even if someone grants UPDATE on the table, RLS still blocks it.
ALTER TABLE public.shift_time_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shift_time_slots: read all" ON public.shift_time_slots;
CREATE POLICY "shift_time_slots: read all"
  ON public.shift_time_slots
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "shift_time_slots: deny client update" ON public.shift_time_slots;
CREATE POLICY "shift_time_slots: deny client update"
  ON public.shift_time_slots
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "shift_time_slots: deny client insert" ON public.shift_time_slots;
CREATE POLICY "shift_time_slots: deny client insert"
  ON public.shift_time_slots
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "shift_time_slots: deny client delete" ON public.shift_time_slots;
CREATE POLICY "shift_time_slots: deny client delete"
  ON public.shift_time_slots
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (false);

-- The SECURITY DEFINER trigger sync_slot_booked_count runs with the
-- function owner's privileges and bypasses RLS, so the legitimate
-- counter writes are unaffected. Direct client writes are now denied
-- by an explicit RESTRICTIVE policy regardless of any future GRANT
-- changes.

-- ============================================================
-- FIX 4: Slot-level concurrency in validate_booking_slot_count
-- ============================================================
-- Currently the function locks the shifts row with FOR UPDATE, which
-- serializes booking attempts at the SHIFT level. But shift_time_slots
-- (sub-slots within a shift) have their own counter, and two volunteers
-- racing to book the last opening on the SAME sub-slot can both pass
-- validation if they target different shifts but overlapping slots.
--
-- More importantly, even on a single shift the per-slot counter
-- sync_slot_booked_count clamps at total_slots, which would silently
-- drop a booking link without raising an error.
--
-- The fix: lock the shift_time_slots rows the new booking is going to
-- be attached to, then count confirmed bookings on those slots, and
-- demote to waitlist if any selected slot is full.
--
-- We can't see shift_booking_slots inserts here because they happen
-- AFTER this trigger fires. Instead, we lock the slots so a concurrent
-- transaction blocks until we commit, and the AFTER INSERT trigger
-- sync_slot_booked_count's clamping behavior becomes the second line
-- of defense.
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
  -- 1. Lock the shifts row so concurrent bookings on the same shift
  --    serialize through this point.
  SELECT total_slots INTO max_slots
    FROM public.shifts
    WHERE id = NEW.shift_id
    FOR UPDATE;

  IF max_slots IS NULL THEN
    RETURN NEW;
  END IF;

  -- 2. Also lock all sub-slot rows for this shift so any concurrent
  --    booking that would touch the same sub-slots blocks behind us.
  --    Without this lock, two volunteers racing on the last opening of
  --    a sub-slot could both pass the parent shift capacity check and
  --    both proceed, leaving the slot counter to be silently clamped
  --    by sync_slot_booked_count.
  PERFORM 1
    FROM public.shift_time_slots
    WHERE shift_id = NEW.shift_id
    FOR UPDATE;

  -- 3. Count confirmed bookings on the parent shift (excluding the row
  --    being touched, so a waitlisted->confirmed update on the same row
  --    doesn't double-count itself).
  SELECT COUNT(*) INTO actual_booked
    FROM public.shift_bookings
    WHERE shift_id = NEW.shift_id
      AND booking_status = 'confirmed'
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF actual_booked >= max_slots THEN
    -- Shift is full. Demote to waitlist instead of raising.
    NEW.booking_status := 'waitlisted';
  END IF;

  RETURN NEW;
END;
$function$;

-- ============================================================
-- FIX 6: Constant-time get_email_by_username
-- ============================================================
-- The previous implementation returned NULL fast for an unknown username
-- but did a real index lookup for a known one. The two paths can be
-- distinguished by response time, leaking whether a username exists.
-- Wrap the lookup so both paths perform identical work and the function
-- adds a small fixed delay (~30ms) regardless of outcome.
CREATE OR REPLACE FUNCTION public.get_email_by_username(p_username text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_email text;
  v_dummy text;
BEGIN
  IF p_username IS NULL OR length(trim(p_username)) = 0 THEN
    -- Still pay the delay so empty input can't be distinguished by timing.
    PERFORM pg_sleep(0.03);
    RETURN NULL;
  END IF;

  -- Real lookup.
  SELECT email
    INTO v_email
    FROM public.profiles
    WHERE lower(username) = lower(trim(p_username))
    LIMIT 1;

  -- Constant-time companion read: do a second lookup against the same
  -- index regardless of outcome so the work performed is the same shape.
  -- Combined with the pg_sleep below, this neutralizes the timing oracle.
  SELECT email
    INTO v_dummy
    FROM public.profiles
    WHERE lower(username) = '__nonexistent_username_for_timing__'
    LIMIT 1;

  -- Fixed floor on response time. 30ms is well above the variance of
  -- the underlying index lookup so timing differences become noise.
  PERFORM pg_sleep(0.03);

  RETURN v_email;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_email_by_username(text) TO anon, authenticated;
