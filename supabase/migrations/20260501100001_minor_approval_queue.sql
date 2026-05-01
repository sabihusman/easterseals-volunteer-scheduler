-- =============================================
-- Half B-1 — Step 2 of 2: minor approval queue
--
-- See PR description for the full Phase 1 audits driving these
-- changes. Summary of what this migration does:
--
--   1. DROP departments.min_age (zero functional enforcement;
--      replaced by the is_minor → admin-approval flow).
--
--   2. DROP TABLE parental_consents CASCADE (drops 4 RLS policies).
--      The product decision is that admin approval supersedes
--      parental consent — see the prior brief's decision (2)(a).
--
--   3. Rewrite enforce_booking_window() — remove the parental-consent
--      block. (Emergency-contact, BG-check, and booking-window blocks
--      are unchanged.)
--
--   4. New BEFORE INSERT trigger trg_route_minor_to_pending — if
--      profiles.is_minor is true, override booking_status to
--      'pending_admin_approval' regardless of what the client sent.
--      Defensive against malicious / buggy clients.
--
--   5. New BEFORE UPDATE trigger trg_enforce_admin_only_approval —
--      block any non-admin transitioning a row out of
--      'pending_admin_approval' (volunteer can't self-promote;
--      coordinator can't approve — admin-only by design).
--
--   6. Update prevent_overlapping_bookings() — include
--      'pending_admin_approval' in the overlap-blocking set so a minor
--      can't double-hold two overlapping shifts in pending state.
--
--   7. Update sync_booked_slots() — handle the new transitions
--      cleanly. pending → confirmed counts as +1; pending → rejected
--      and pending → cancelled are no-ops (slot was never filled).
--
--   8. Rebuild uq_booking_per_slot — extend uniqueness to include
--      'pending_admin_approval' so a minor can't queue two pendings on
--      the same slot.
--
--   9. Tighten the volunteer-insert RLS policy — CASE WHEN on
--      profiles.is_minor permits adults to insert only confirmed/
--      waitlisted; minors only end up at pending_admin_approval (the
--      trigger rewrites their value, and WITH CHECK runs after BEFORE
--      INSERT triggers per Postgres semantics).
--
--  10. Update cascade-cancel functions on profile/shift cancel to
--      include 'pending_admin_approval' bookings so a cancelled shift
--      cancels its pending bookings too (with the same notification).
-- =============================================

-- ── 1. Drop departments.min_age ──
-- Phase 1.3 audit: zero functional enforcement (no trigger, no RPC,
-- no RLS, no booking-time check references this). Removing the
-- column drops the cosmetic edit field on AdminDepartments.tsx
-- (handled in same PR's frontend changes) but breaks no business
-- logic.
ALTER TABLE public.departments DROP COLUMN min_age;

-- ── 2. Drop parental_consents (cascades 4 RLS policies) ──
-- Phase 1.2 audit: no external FK in, no view depends on it, no
-- shared user-defined function references it (the only consumer
-- was the consent block in enforce_booking_window() which is
-- rewritten in step 3). CASCADE drop is clean.
DROP TABLE IF EXISTS public.parental_consents CASCADE;

-- ── 3. Rewrite enforce_booking_window() — remove consent block ──
-- The function previously gated minor bookings on an active
-- parental_consents row. Admin approval now supersedes consent;
-- the gate moves to the new trg_route_minor_to_pending trigger
-- (which routes minors into the approval queue) and the
-- /admin/pending-minor-approvals admin page.
CREATE OR REPLACE FUNCTION public.enforce_booking_window()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  shift_rec  record;
  max_days   int;
  vol        public.profiles%rowtype;
BEGIN
  SELECT * INTO vol FROM public.profiles WHERE id = NEW.volunteer_id;

  -- Emergency contact gate (unchanged).
  IF vol.emergency_contact_name IS NULL OR TRIM(vol.emergency_contact_name) = '' THEN
    RAISE EXCEPTION 'Emergency contact required. Please add an emergency contact name in your profile settings before booking a shift.';
  END IF;
  IF vol.emergency_contact_phone IS NULL OR TRIM(vol.emergency_contact_phone) = '' THEN
    RAISE EXCEPTION 'Emergency contact required. Please add an emergency contact phone number in your profile settings before booking a shift.';
  END IF;

  -- (Half B-1: parental-consent block removed; minor routing now
  -- happens in trg_route_minor_to_pending below, which sets
  -- booking_status='pending_admin_approval' for minors. The booking
  -- proceeds; admin reviews via the /admin/pending-minor-approvals
  -- queue.)

  SELECT s.shift_date, s.start_time, s.end_time, s.requires_bg_check,
         d.requires_bg_check AS dept_bg_check
  INTO shift_rec
  FROM public.shifts s
  JOIN public.departments d ON d.id = s.department_id
  WHERE s.id = NEW.shift_id;

  -- Background check enforcement (unchanged).
  IF shift_rec.requires_bg_check OR shift_rec.dept_bg_check THEN
    IF vol.bg_check_status != 'cleared' THEN
      RAISE EXCEPTION 'This shift requires a cleared background check. Your current status is: %', vol.bg_check_status;
    END IF;
    IF vol.bg_check_expires_at IS NOT NULL AND vol.bg_check_expires_at < now() THEN
      RAISE EXCEPTION 'Your background check has expired. Please renew before booking this shift.';
    END IF;
  END IF;

  -- Booking window enforcement (unchanged).
  max_days := CASE WHEN vol.extended_booking THEN 21 ELSE 14 END;
  IF (shift_rec.shift_date - current_date) > max_days THEN
    RAISE EXCEPTION 'Booking window exceeded. You can book up to % days in advance.', max_days;
  END IF;
  IF shift_rec.shift_date < current_date THEN
    RAISE EXCEPTION 'Cannot book a shift in the past.';
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 4. New trigger: route minor bookings to pending_admin_approval ──
-- Fires BEFORE INSERT on shift_bookings. If the volunteer is a minor,
-- override booking_status to 'pending_admin_approval' regardless of
-- what the client sent. Per Postgres semantics, this fires before
-- the volunteer-insert RLS WITH CHECK is evaluated, so the WITH CHECK
-- (defined in step 9 below) sees the rewritten value.
CREATE OR REPLACE FUNCTION public.route_minor_booking_to_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_minor boolean;
BEGIN
  -- SECURITY DEFINER lets us read profiles.is_minor even if the
  -- invoker's RLS would block it. is_minor is sourced from the
  -- signup over-18 toggle (see Half A migration
  -- 20260501000000_remove_dob_capture.sql) — no user-controlled
  -- inputs reach this lookup beyond the volunteer_id the row is
  -- being inserted with.
  SELECT is_minor INTO v_is_minor
  FROM public.profiles
  WHERE id = NEW.volunteer_id;

  IF v_is_minor THEN
    NEW.booking_status := 'pending_admin_approval';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.route_minor_booking_to_pending() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_route_minor_to_pending ON public.shift_bookings;
-- Trigger order matters: this must run BEFORE the validate-slots
-- trigger (which fires WHEN status='confirmed') and BEFORE the
-- prevent-overlapping trigger so the rewrite is visible to all
-- downstream BEFORE triggers. Postgres fires BEFORE triggers in
-- name order — `trg_a_*` runs before `trg_e_*` etc. Naming this
-- trigger with an `00_` prefix puts it first.
CREATE TRIGGER trg_00_route_minor_to_pending
  BEFORE INSERT ON public.shift_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.route_minor_booking_to_pending();

-- ── 5. Admin-only approval guard ──
-- Prevents non-admins (volunteers themselves, coordinators) from
-- transitioning a row out of pending_admin_approval. RLS WITH CHECK
-- doesn't have access to OLD.booking_status, so this enforcement
-- belongs in a trigger.
CREATE OR REPLACE FUNCTION public.enforce_admin_only_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only relevant when the row is leaving pending state.
  IF OLD.booking_status IS DISTINCT FROM 'pending_admin_approval' THEN
    RETURN NEW;
  END IF;
  IF NEW.booking_status = 'pending_admin_approval' THEN
    RETURN NEW;
  END IF;

  -- Only admins may approve (→ confirmed) or deny (→ rejected).
  -- Volunteer/coordinator-driven cancellations of a still-pending
  -- booking go to 'cancelled' — that's allowed (volunteer can
  -- cancel their own pending request, coordinator can cancel on
  -- their behalf if needed via the existing cancel UI).
  IF NEW.booking_status IN ('confirmed', 'rejected') THEN
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only an administrator may approve or reject a pending booking.'
        USING ERRCODE = '42501';  -- insufficient_privilege
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.enforce_admin_only_approval() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_enforce_admin_only_approval ON public.shift_bookings;
CREATE TRIGGER trg_enforce_admin_only_approval
  BEFORE UPDATE OF booking_status ON public.shift_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_admin_only_approval();

-- ── 6. Update overlap prevention to include pending ──
-- Phase 1.1 decision (B-1): a minor's pending booking blocks
-- another overlapping pending or confirmed/waitlisted booking by
-- the same volunteer. Rebuild the function with the extended IN
-- clause.
CREATE OR REPLACE FUNCTION public.prevent_overlapping_bookings()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  new_start time;
  new_end   time;
  new_date  date;
  overlap_count int;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.booking_status = NEW.booking_status THEN RETURN NEW; END IF;
  -- Half B-1: pending bookings now block overlap too.
  IF NEW.booking_status NOT IN ('confirmed', 'waitlisted', 'pending_admin_approval') THEN
    RETURN NEW;
  END IF;
  SELECT s.shift_date INTO new_date FROM public.shifts s WHERE s.id = NEW.shift_id;
  IF NEW.time_slot_id IS NOT NULL THEN
    SELECT sts.slot_start, sts.slot_end INTO new_start, new_end FROM public.shift_time_slots sts WHERE sts.id = NEW.time_slot_id;
  ELSE
    SELECT s.start_time, s.end_time INTO new_start, new_end FROM public.shifts s WHERE s.id = NEW.shift_id;
  END IF;
  IF new_start IS NULL OR new_end IS NULL THEN RETURN NEW; END IF;
  SELECT COUNT(*) INTO overlap_count
  FROM public.shift_bookings sb
  JOIN public.shifts s ON s.id = sb.shift_id
  LEFT JOIN public.shift_time_slots sts ON sts.id = sb.time_slot_id
  WHERE sb.volunteer_id = NEW.volunteer_id
    AND sb.booking_status IN ('confirmed', 'waitlisted', 'pending_admin_approval')
    AND sb.id != NEW.id
    AND s.shift_date = new_date
    AND COALESCE(sts.slot_start, s.start_time) < new_end
    AND COALESCE(sts.slot_end, s.end_time) > new_start;
  IF overlap_count > 0 THEN
    RAISE EXCEPTION 'You already have a booking that overlaps with this shift time.';
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 7. Update sync_booked_slots to handle pending transitions ──
-- pending → confirmed is the slot-fill event; pending → rejected
-- and pending → cancelled are no-ops (the slot was never filled).
-- Also covers pending → pending (e.g. if a future feature touches
-- the row without changing status, no double-counting).
CREATE OR REPLACE FUNCTION public.sync_booked_slots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_slot_id uuid;
  v_shift_id uuid;
BEGIN
  v_shift_id := COALESCE(NEW.shift_id, OLD.shift_id);
  v_slot_id  := COALESCE(NEW.time_slot_id, OLD.time_slot_id);
  IF v_slot_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' AND NEW.booking_status = 'confirmed' THEN
      UPDATE public.shift_time_slots SET booked_slots = LEAST(booked_slots + 1, total_slots) WHERE id = v_slot_id;
    ELSIF TG_OP = 'UPDATE' THEN
      -- confirmed → anything-not-confirmed: -1
      IF OLD.booking_status = 'confirmed' AND NEW.booking_status IN ('cancelled', 'waitlisted', 'rejected', 'pending_admin_approval') THEN
        UPDATE public.shift_time_slots SET booked_slots = GREATEST(booked_slots - 1, 0) WHERE id = v_slot_id;
      -- waitlisted/cancelled/pending → confirmed: +1
      ELSIF OLD.booking_status IN ('waitlisted', 'cancelled', 'pending_admin_approval') AND NEW.booking_status = 'confirmed' THEN
        UPDATE public.shift_time_slots SET booked_slots = LEAST(booked_slots + 1, total_slots) WHERE id = v_slot_id;
      END IF;
    END IF;
  ELSE
    IF TG_OP = 'INSERT' AND NEW.booking_status = 'confirmed' THEN
      UPDATE public.shifts SET booked_slots = booked_slots + 1 WHERE id = v_shift_id;
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.booking_status = 'confirmed' AND NEW.booking_status IN ('cancelled', 'waitlisted', 'rejected', 'pending_admin_approval') THEN
        UPDATE public.shifts SET booked_slots = GREATEST(booked_slots - 1, 0) WHERE id = v_shift_id;
      ELSIF OLD.booking_status IN ('waitlisted', 'cancelled', 'pending_admin_approval') AND NEW.booking_status = 'confirmed' THEN
        UPDATE public.shifts SET booked_slots = booked_slots + 1 WHERE id = v_shift_id;
      END IF;
    END IF;
  END IF;
  -- Reconcile against the source of truth — count of confirmed
  -- bookings for the shift. Pending/rejected/waitlisted/cancelled
  -- are excluded by the equality filter, which is the desired
  -- semantics (pending DOES NOT fill a slot until approval).
  UPDATE public.shifts SET booked_slots = (
    SELECT COUNT(*) FROM public.shift_bookings WHERE shift_id = v_shift_id AND booking_status = 'confirmed'
  ) WHERE id = v_shift_id;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- ── 8. Rebuild uq_booking_per_slot to include pending ──
-- Phase 1.1 decision (B-1.1): pending counts toward uniqueness, so
-- a minor can't queue two pending bookings on the same slot.
DROP INDEX IF EXISTS public.uq_booking_per_slot;
CREATE UNIQUE INDEX uq_booking_per_slot
  ON public.shift_bookings (shift_id, volunteer_id, time_slot_id)
  WHERE time_slot_id IS NOT NULL
    AND booking_status IN ('confirmed', 'waitlisted', 'pending_admin_approval');

-- ── 9. Tighten the volunteer-insert RLS policy ──
-- Phase 1.1 decision (C): RLS as a value-domain constraint. The
-- BEFORE INSERT trigger trg_00_route_minor_to_pending rewrites
-- minors' booking_status to 'pending_admin_approval' before WITH
-- CHECK runs, so the policy must permit that value for minors.
-- The CASE WHEN keeps adults from sneaking pending in directly.
--
-- The is_minor lookup goes through a SECURITY DEFINER helper to
-- avoid an RLS recursion: a naive `SELECT is_minor FROM profiles
-- WHERE id = auth.uid()` inside the policy triggers profiles' own
-- RLS, and one of profiles' SELECT policies references
-- shift_bookings — Postgres rejects this with SQLSTATE 42P17
-- (infinite recursion in policy). Same pattern the codebase
-- already uses for is_admin() / is_coordinator_or_admin().
CREATE OR REPLACE FUNCTION public.is_current_user_minor()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT is_minor FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;
ALTER FUNCTION public.is_current_user_minor() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.is_current_user_minor() TO authenticated, anon, service_role;

DROP POLICY IF EXISTS "bookings: volunteer insert" ON public.shift_bookings;
CREATE POLICY "bookings: volunteer insert"
  ON public.shift_bookings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    volunteer_id = auth.uid()
    AND CASE
      WHEN public.is_current_user_minor()
        THEN booking_status = 'pending_admin_approval'
        ELSE booking_status IN ('confirmed', 'waitlisted')
      END
  );

-- ── 10. Update cascade-cancel functions to include pending ──
-- When a shift is cancelled, pending bookings should also be
-- cancelled (with the same notification fan-out the existing
-- cancellation flow does). Same when a volunteer's booking
-- privileges are revoked or BG check transitions to failed/expired.
-- The existing functions filter `booking_status = 'confirmed'`;
-- extend to include 'waitlisted' (already handled in some) and
-- 'pending_admin_approval' (new). 'rejected' is excluded — those
-- are already terminal.

-- enforce_eligibility_on_profile_update has two cascade blocks; we
-- recreate the whole function to extend both. Existing logic
-- preserved aside from the IN clause.
CREATE OR REPLACE FUNCTION public.enforce_eligibility_on_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  -- If booking privileges revoked, cancel all future
  -- confirmed/waitlisted/pending bookings.
  IF NEW.booking_privileges = false AND OLD.booking_privileges = true THEN
    UPDATE public.shift_bookings sb
    SET booking_status = 'cancelled',
        cancelled_at = now(),
        updated_at = now()
    FROM public.shifts s
    WHERE sb.shift_id = s.id
      AND sb.volunteer_id = NEW.id
      AND sb.booking_status IN ('confirmed', 'waitlisted', 'pending_admin_approval')
      AND s.shift_date >= current_date;

    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (
      NEW.id,
      'booking_privileges_revoked',
      'Booking Privileges Revoked',
      'Your booking privileges have been revoked by an administrator. Your upcoming shift bookings have been cancelled. Please contact your coordinator.',
      '/my-shifts'
    );
  END IF;

  -- If BG check transitions into a non-cleared state and any of the
  -- volunteer's upcoming shifts require a BG check, cancel those.
  IF NEW.bg_check_status IN ('failed', 'expired')
     AND OLD.bg_check_status = 'cleared' THEN
    UPDATE public.shift_bookings sb
    SET booking_status = 'cancelled',
        cancelled_at = now(),
        updated_at = now()
    FROM public.shifts s
    JOIN public.departments d ON d.id = s.department_id
    WHERE sb.shift_id = s.id
      AND sb.volunteer_id = NEW.id
      AND sb.booking_status IN ('confirmed', 'waitlisted', 'pending_admin_approval')
      AND s.shift_date >= current_date
      AND (s.requires_bg_check OR d.requires_bg_check);

    INSERT INTO public.notifications (user_id, type, title, message, link)
    VALUES (
      NEW.id,
      'bg_check_status_changed',
      'Background Check Status Changed',
      'Your background check status is now ' || NEW.bg_check_status || '. Bookings for shifts requiring a background check have been cancelled.',
      '/my-shifts'
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- The shift-cancel cascade lives in src/lib/shift-cancel.ts (PR #173)
-- as a TS helper that does the UPDATE directly rather than a DB
-- trigger. The same-PR frontend changes update that helper to
-- include 'pending_admin_approval' in its WHERE clause; no DB
-- function to rewrite here.

-- The profile-FK-cascade-audit migration (20260423000002) defines
-- cancel_bookings_on_profile_delete() — extend its IN clause to
-- include pending_admin_approval. The trigger that calls it is
-- unchanged structurally.
CREATE OR REPLACE FUNCTION public.cancel_bookings_on_profile_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.role = 'volunteer' THEN
    UPDATE public.shift_bookings
    SET booking_status = 'cancelled',
        cancelled_at = now(),
        updated_at = now()
    WHERE volunteer_id = OLD.id
      AND booking_status IN ('confirmed', 'waitlisted', 'pending_admin_approval');
  END IF;
  RETURN OLD;
END;
$$;
