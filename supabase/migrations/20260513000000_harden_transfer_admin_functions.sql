-- Hotfix: caller-identity checks on transfer_admin_role and
-- transfer_coordinator_and_delete.
--
-- Surfaced by the 2026-05-13 Supabase Security Advisor sweep
-- (see GitHub issue: "Phase 1 — SECURITY DEFINER triage").
--
-- Both functions are SECURITY DEFINER and (per the default
-- public-schema grants) callable by `anon` and `authenticated`.
-- Their existing internal checks validate the *target* arguments
-- (the from-admin's role, the target coordinator's role) but
-- NEVER verify that `auth.uid()` is the supposed-source admin or
-- that the caller holds the admin role. That means any
-- authenticated user — or any anon caller with the project's
-- anon key — could call:
--
--   select transfer_admin_role(<some_admin_uuid>, <some_coord_uuid>);
--
-- and successfully flip the admin role to a coordinator of their
-- choosing. Same shape for transfer_coordinator_and_delete, which
-- additionally has the power to delete a coordinator profile and
-- reassign their departments.
--
-- The Phase 2 lockdown PR will REVOKE these functions' EXECUTE
-- grants from anon (keeping only authenticated, gated by the
-- checks added here) as defence-in-depth. This hotfix lands the
-- *authoritative* check inside each function body so the
-- vulnerability is closed regardless of grant state.
--
-- Compat note for transfer_admin_role's frontend caller
-- (src/pages/AdminSettings.tsx:39-42): the UI already passes
-- `from_admin_id: user.id`, so `auth.uid() = from_admin_id`
-- holds for legitimate calls. No frontend change required.
--
-- transfer_coordinator_and_delete has no frontend caller today;
-- the check enforces the same invariant for when a UI is wired
-- up.

-- ────────────────────────────────────────────────────────────
-- 1. transfer_admin_role
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_admin_role(
  from_admin_id    uuid,
  to_coordinator_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  target_role public.user_role;
BEGIN
  -- Caller-identity check (the hotfix). auth.uid() returns NULL for
  -- anon (unauthenticated) callers and the authenticated user's UUID
  -- otherwise. Reject any call where the claimed source-admin is not
  -- the actual caller.
  IF auth.uid() IS NULL OR auth.uid() <> from_admin_id THEN
    RAISE EXCEPTION 'forbidden: caller must be the source admin'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin role required'
      USING ERRCODE = '42501';
  END IF;

  -- Pre-existing target-state validation (unchanged).
  IF (SELECT role FROM public.profiles WHERE id = from_admin_id) <> 'admin' THEN
    RAISE EXCEPTION 'Source user is not an admin.';
  END IF;
  SELECT role INTO target_role FROM public.profiles WHERE id = to_coordinator_id;
  IF target_role <> 'coordinator' THEN
    RAISE EXCEPTION 'Admin role can only be transferred to a coordinator.';
  END IF;

  -- Set session flag to bypass self-escalation check during transfer
  PERFORM set_config('app.skip_self_escalation_check', 'true', true);
  UPDATE public.profiles SET role = 'coordinator', updated_at = now() WHERE id = from_admin_id;
  UPDATE public.profiles SET role = 'admin',       updated_at = now() WHERE id = to_coordinator_id;
  PERFORM set_config('app.skip_self_escalation_check', 'false', true);
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 2. transfer_coordinator_and_delete
-- ────────────────────────────────────────────────────────────
-- Insert the caller-identity check at the very top of the function.
-- The body is otherwise unchanged from the baseline definition.
CREATE OR REPLACE FUNCTION public.transfer_coordinator_and_delete(
  p_coordinator_id uuid,
  p_admin_id       uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coord_role       text;
  v_coord_name       text;
  v_admin_role       text;
  v_dept             record;
  v_other_coord_id   uuid;
  v_depts_transferred  int := 0;
  v_depts_removed      int := 0;
  v_shifts_transferred int := 0;
  v_notifs_deleted     int := 0;
  v_step               text := 'caller_check';
BEGIN
  -- Caller-identity check (the hotfix). See transfer_admin_role for
  -- rationale.
  IF auth.uid() IS NULL OR auth.uid() <> p_admin_id THEN
    RAISE EXCEPTION 'forbidden: caller must be the acting admin'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin role required'
      USING ERRCODE = '42501';
  END IF;

  v_step := 'validation';

  -- ────────────────────────────────────────────────────────
  -- 0. Validate inputs (unchanged below this line)
  -- ────────────────────────────────────────────────────────
  SELECT role, full_name INTO v_coord_role, v_coord_name
    FROM public.profiles WHERE id = p_coordinator_id;

  IF v_coord_role IS NULL THEN
    RETURN jsonb_build_object(
      'success', false, 'step', v_step,
      'error', 'Coordinator profile not found.');
  END IF;

  IF v_coord_role <> 'coordinator' THEN
    RETURN jsonb_build_object(
      'success', false, 'step', v_step,
      'error', 'Target user is not a coordinator (role: ' || v_coord_role || ').');
  END IF;

  SELECT role INTO v_admin_role
    FROM public.profiles WHERE id = p_admin_id;

  IF v_admin_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object(
      'success', false, 'step', v_step,
      'error', 'Performing user is not an admin.');
  END IF;

  IF p_coordinator_id = p_admin_id THEN
    RETURN jsonb_build_object(
      'success', false, 'step', v_step,
      'error', 'Cannot delete yourself.');
  END IF;

  -- ────────────────────────────────────────────────────────
  -- 1. Department ownership transfer
  -- ────────────────────────────────────────────────────────
  v_step := 'department_transfer';

  FOR v_dept IN
    SELECT dc.department_id
      FROM public.department_coordinators dc
     WHERE dc.coordinator_id = p_coordinator_id
  LOOP
    SELECT dc.coordinator_id INTO v_other_coord_id
      FROM public.department_coordinators dc
     WHERE dc.department_id = v_dept.department_id
       AND dc.coordinator_id <> p_coordinator_id
     LIMIT 1;

    IF v_other_coord_id IS NULL THEN
      INSERT INTO public.department_coordinators (coordinator_id, department_id)
      VALUES (p_admin_id, v_dept.department_id)
      ON CONFLICT (coordinator_id, department_id) DO NOTHING;
      v_depts_transferred := v_depts_transferred + 1;
    ELSE
      v_depts_removed := v_depts_removed + 1;
    END IF;
  END LOOP;

  DELETE FROM public.department_coordinators
   WHERE coordinator_id = p_coordinator_id;

  -- ────────────────────────────────────────────────────────
  -- 2. Shift ownership transfer
  -- ────────────────────────────────────────────────────────
  v_step := 'shift_transfer';

  UPDATE public.shifts s
     SET created_by  = COALESCE(
           (SELECT dc.coordinator_id
              FROM public.department_coordinators dc
             WHERE dc.department_id = s.department_id
               AND dc.coordinator_id <> p_coordinator_id
             LIMIT 1),
           p_admin_id
         ),
         updated_at = now()
   WHERE s.created_by = p_coordinator_id;

  GET DIAGNOSTICS v_shifts_transferred = ROW_COUNT;

  -- ────────────────────────────────────────────────────────
  -- 3. Reassign / nullify all remaining NO-ACTION FKs
  -- ────────────────────────────────────────────────────────
  v_step := 'reassign_references';

  UPDATE public.shift_bookings
     SET coordinator_actioned_by = p_admin_id
   WHERE coordinator_actioned_by = p_coordinator_id;

  UPDATE public.shift_bookings
     SET confirmed_by = p_admin_id
   WHERE confirmed_by = p_coordinator_id;

  UPDATE public.attendance_disputes
     SET coordinator_id = p_admin_id
   WHERE coordinator_id = p_coordinator_id;

  UPDATE public.shift_notes
     SET author_id = p_admin_id
   WHERE author_id = p_coordinator_id;

  UPDATE public.shift_invitations
     SET invited_by = p_admin_id
   WHERE invited_by = p_coordinator_id;

  UPDATE public.shift_attachments
     SET uploader_id = p_admin_id
   WHERE uploader_id = p_coordinator_id;

  UPDATE public.shift_recurrence_rules
     SET created_by = p_admin_id
   WHERE created_by = p_coordinator_id;

  UPDATE public.conversations
     SET created_by = p_admin_id
   WHERE created_by = p_coordinator_id;

  UPDATE public.messages
     SET sender_id = p_admin_id
   WHERE sender_id = p_coordinator_id;

  DELETE FROM public.confirmation_reminders
   WHERE recipient_id = p_coordinator_id;

  UPDATE public.admin_action_log
     SET admin_id = p_admin_id
   WHERE admin_id = p_coordinator_id;

  UPDATE public.private_note_access_log
     SET admin_user_id = p_admin_id
   WHERE admin_user_id = p_coordinator_id;

  UPDATE public.document_types
     SET created_by = p_admin_id
   WHERE created_by = p_coordinator_id;

  UPDATE public.events
     SET created_by = p_admin_id
   WHERE created_by = p_coordinator_id;

  DELETE FROM public.event_registrations
   WHERE volunteer_id = p_coordinator_id;

  DELETE FROM public.volunteer_shift_reports
   WHERE volunteer_id = p_coordinator_id;

  UPDATE public.department_restrictions
     SET restricted_by = p_admin_id
   WHERE restricted_by = p_coordinator_id;

  DELETE FROM public.shift_bookings
   WHERE volunteer_id = p_coordinator_id;

  -- ────────────────────────────────────────────────────────
  -- 4. Notification cleanup
  -- ────────────────────────────────────────────────────────
  v_step := 'notification_cleanup';

  DELETE FROM public.notifications
   WHERE user_id = p_coordinator_id
     AND is_read = false;

  GET DIAGNOSTICS v_notifs_deleted = ROW_COUNT;

  -- ────────────────────────────────────────────────────────
  -- 5. Delete the profile
  -- ────────────────────────────────────────────────────────
  v_step := 'delete_profile';

  DELETE FROM public.profiles WHERE id = p_coordinator_id;

  RETURN jsonb_build_object(
    'success',                 true,
    'coordinator_name',        v_coord_name,
    'departments_transferred', v_depts_transferred,
    'departments_removed',     v_depts_removed,
    'shifts_transferred',      v_shifts_transferred,
    'notifications_deleted',   v_notifs_deleted
  );

EXCEPTION
  -- Caller-identity failure must bubble out as a real error so the
  -- client sees 403. Don't swallow it into the {success:false}
  -- envelope (that pattern is reserved for business-logic failures
  -- on validated inputs).
  WHEN SQLSTATE '42501' THEN
    RAISE;
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'step',    v_step,
      'error',   SQLERRM
    );
END;
$$;
