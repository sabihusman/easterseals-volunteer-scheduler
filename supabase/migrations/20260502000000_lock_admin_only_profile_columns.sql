-- =============================================
-- Lock admin-only profile columns against volunteer self-update.
--
-- Background
-- ----------
-- The `profiles: own update` RLS policy (defined in baseline.sql)
-- has no WITH CHECK clause:
--
--   CREATE POLICY "profiles: own update" ON public.profiles
--     FOR UPDATE USING (auth.uid() = id);
--
-- That means any authenticated user can PATCH their own profile row
-- with arbitrary column values. During the Half B-1 prod migration
-- investigation (2026-05-02) I demonstrated this concretely: a
-- newly-signed-up volunteer (Test Minor B1) was able to flip
-- `bg_check_status` from `pending` to `cleared` directly via Supabase
-- REST. This bypasses the booking-window BG-check gate in
-- enforce_booking_window — a real privilege escalation.
--
-- Why a trigger and not a tighter RLS WITH CHECK
-- -----------------------------------------------
-- RLS WITH CHECK only sees the new row, not the old. There's no
-- cross-row way to express "NEW.col = OLD.col" in a policy. The
-- codebase already uses the trigger pattern for exactly this kind of
-- column-lock — see `prevent_role_self_escalation` (baseline.sql:1566)
-- which protects `profiles.role` against self-promotion. This migration
-- extends the same pattern to cover every other admin-controlled
-- column.
--
-- What's locked (non-admin users cannot change)
-- ---------------------------------------------
--   - bg_check_status            ← driver of this PR
--   - bg_check_expires_at
--   - bg_check_updated_at
--   - is_active                  ← admin activation gate
--   - booking_privileges         ← admin-controlled grant
--   - is_minor                   ← signup-only; protects approval queue
--   - messaging_blocked          ← admin moderation flag
--   - consistency_score          ← derived from completed shifts
--   - extended_booking           ← derived from consistency_score
--   - total_hours                ← aggregate of confirmed bookings
--   - volunteer_points           ← derived from hours + ratings
--   - location_id                ← admin-assigned dept / location
--   - tos_accepted_at            ← historical record
--   - created_at                 ← never editable
--
-- What's NOT locked (volunteer can still self-edit)
-- -------------------------------------------------
--   - full_name, phone, avatar_url, username (separate flow), email
--   - emergency_contact_name, emergency_contact_phone
--   - notif_* preference columns
--   - onboarding_complete (volunteer flips this themselves)
--   - updated_at (timestamp the user's own client sets)
--
-- The existing `role` lock from `prevent_role_self_escalation` stays
-- as-is; this migration adds protection for every other admin column.
-- Both triggers fire on the same UPDATE — no conflict.
--
-- Admins bypass the lock via `public.is_admin()`; service-role calls
-- bypass RLS and triggers entirely (the booking-trigger function uses
-- SECURITY DEFINER for similar reasons).
-- =============================================

CREATE OR REPLACE FUNCTION public.prevent_user_from_changing_admin_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Admins can change anything. Service-role bypasses RLS+triggers.
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  -- Same escape hatch the role-escalation guard uses, in case a
  -- future admin-transfer flow needs to bypass this too.
  IF current_setting('app.skip_self_escalation_check', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Only check rows the actor owns. A coordinator updating someone
  -- else's profile is gated by other policies; this trigger is about
  -- self-update overreach.
  IF NEW.id IS DISTINCT FROM auth.uid() THEN
    RETURN NEW;
  END IF;

  -- BG-check fields — the security finding driving this PR.
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

  -- Minor flag — answered once at signup (Half A); editing it later
  -- would let a minor bypass the admin approval queue (Half B-1).
  IF NEW.is_minor IS DISTINCT FROM OLD.is_minor THEN
    RAISE EXCEPTION 'You cannot change your own minor status. Contact an administrator if this needs correction.'
      USING ERRCODE = '42501';
  END IF;

  -- Derived / aggregate fields — these are computed by triggers
  -- (recalculate_consistency, recalculate_points, etc.) and the
  -- volunteer should never write to them directly.
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

  -- Admin-assigned slot.
  IF NEW.location_id IS DISTINCT FROM OLD.location_id THEN
    RAISE EXCEPTION 'You cannot change your own location assignment.'
      USING ERRCODE = '42501';
  END IF;

  -- Historical immutables.
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

-- Granting EXECUTE to authenticated/anon/service_role mirrors how
-- prevent_role_self_escalation was granted in baseline.sql.
GRANT EXECUTE ON FUNCTION public.prevent_user_from_changing_admin_columns()
  TO anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_prevent_user_from_changing_admin_columns ON public.profiles;
CREATE TRIGGER trg_prevent_user_from_changing_admin_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_user_from_changing_admin_columns();
