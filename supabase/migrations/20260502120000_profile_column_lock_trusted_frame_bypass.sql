-- =============================================
-- Hotfix for PR #184 regression: volunteer self-confirm flow blocked.
--
-- See issue #187 for the full diagnosis.
--
-- TL;DR: prevent_user_from_changing_admin_columns (added in PR #184)
-- correctly blocks direct REST PATCHes by volunteers attempting to
-- write admin-only columns. But it ALSO blocks legitimate writes
-- coming through SECURITY DEFINER trigger frames — most importantly
-- resolve_hours_discrepancy() which the volunteer self-confirm flow
-- transitively invokes via sync_volunteer_reported_hours() (a
-- SECURITY DEFINER trigger wrapper). The aggregate-recompute UPDATE
-- inside that frame still sees auth.uid() = volunteer (auth.uid is
-- JWT-derived, not function-effective) so the trigger fires and
-- raises 42501 with the "total_hours is an aggregate" message.
--
-- Fix: add a current_user-based bypass before the column-distinctness
-- checks. SECURITY DEFINER frames in this codebase are uniformly
-- owned by postgres, so inside one current_user = 'postgres'. Direct
-- volunteer REST writes have current_user = 'authenticated', so they
-- still go through the lock. service_role calls and direct DB tooling
-- access are also let through (they're already trusted).
--
-- Doesn't open a hole: a volunteer can't elevate to a SECURITY DEFINER
-- frame on their own. They'd need to find a SECURITY DEFINER function
-- that takes user-controlled input and uses it to UPDATE locked
-- columns — that's an attack surface that already exists for ANY RLS
-- rule. The lock just stops being redundant against frames Postgres
-- has already implicitly trusted.
-- =============================================

CREATE OR REPLACE FUNCTION public.prevent_user_from_changing_admin_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Admins can change anything. Stays before the trusted-frame check
  -- because is_admin() depends on auth.uid() which IS preserved across
  -- frames — useful when an admin's REST UPDATE is the actor.
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  -- Same GUC escape hatch the role-escalation guard uses.
  IF current_setting('app.skip_self_escalation_check', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Trusted-frame bypass (NEW in this hotfix).
  --
  -- current_user differs from 'authenticated' / 'anon' only when:
  --   1. We're inside a SECURITY DEFINER function frame (current_user
  --      is the function owner — 'postgres' for this codebase). This
  --      catches the resolve_hours_discrepancy / recalculate_consistency
  --      / recalculate_points paths.
  --   2. Direct DB tooling: psql as service_role / postgres / supabase_*
  --      maintenance roles. Already implicitly trusted.
  --
  -- A volunteer's REST PATCH carries current_user = 'authenticated'
  -- (set by PostgREST after JWT verify), so it does NOT match this
  -- bypass and continues to the column checks below.
  --
  -- Note: session_user can't substitute for current_user here.
  -- PostgREST connects as 'authenticator' and SET ROLEs to
  -- 'authenticated', so session_user != current_user even outside any
  -- SECURITY DEFINER call. Only current_user reliably distinguishes
  -- "request frame" from "trusted-function frame".
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- Only check rows the actor owns. A coordinator updating someone
  -- else's profile is gated by other policies; this trigger is about
  -- self-update overreach.
  IF NEW.id IS DISTINCT FROM auth.uid() THEN
    RETURN NEW;
  END IF;

  -- BG-check fields.
  IF NEW.bg_check_status IS DISTINCT FROM OLD.bg_check_status THEN
    RAISE EXCEPTION 'You cannot change your own background-check status. Contact an administrator.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.bg_check_expires_at IS DISTINCT FROM OLD.bg_check_expires_at THEN
    RAISE EXCEPTION 'You cannot change your own background-check expiration. Contact an administrator.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.bg_check_updated_at IS DISTINCT FROM OLD.bg_check_updated_at THEN
    RAISE EXCEPTION 'You cannot change your own background-check timestamp.'
      USING ERRCODE = '42501';
  END IF;

  -- Admin gates (account state).
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'You cannot change your own active status.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.booking_privileges IS DISTINCT FROM OLD.booking_privileges THEN
    RAISE EXCEPTION 'You cannot change your own booking privileges.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.messaging_blocked IS DISTINCT FROM OLD.messaging_blocked THEN
    RAISE EXCEPTION 'You cannot change your own messaging-blocked status.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.is_minor IS DISTINCT FROM OLD.is_minor THEN
    RAISE EXCEPTION 'You cannot change your own minor status. Contact an administrator if this needs correction.'
      USING ERRCODE = '42501';
  END IF;

  -- Derived / aggregate fields.
  IF NEW.consistency_score IS DISTINCT FROM OLD.consistency_score THEN
    RAISE EXCEPTION 'consistency_score is derived from completed shifts and cannot be set directly.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.extended_booking IS DISTINCT FROM OLD.extended_booking THEN
    RAISE EXCEPTION 'extended_booking is derived from consistency_score and cannot be set directly.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.total_hours IS DISTINCT FROM OLD.total_hours THEN
    RAISE EXCEPTION 'total_hours is an aggregate and cannot be set directly.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.volunteer_points IS DISTINCT FROM OLD.volunteer_points THEN
    RAISE EXCEPTION 'volunteer_points is derived and cannot be set directly.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.location_id IS DISTINCT FROM OLD.location_id THEN
    RAISE EXCEPTION 'You cannot change your own location assignment.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.tos_accepted_at IS DISTINCT FROM OLD.tos_accepted_at THEN
    RAISE EXCEPTION 'tos_accepted_at is a historical record and cannot be modified.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'created_at cannot be modified.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.prevent_user_from_changing_admin_columns() OWNER TO postgres;
