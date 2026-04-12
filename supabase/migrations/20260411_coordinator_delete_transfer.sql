-- ============================================================
-- Coordinator Delete Transfer
-- ============================================================
-- When an admin deletes a coordinator, all responsibilities must
-- be transferred before the profile row can be removed. This
-- function runs every step inside a single transaction so that a
-- failure at any point rolls the whole thing back.
-- ============================================================

CREATE OR REPLACE FUNCTION public.transfer_coordinator_and_delete(
  p_coordinator_id uuid,
  p_admin_id       uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_coord_role       text;
  v_coord_name       text;
  v_admin_role       text;
  v_dept             record;
  v_other_coord_id   uuid;
  v_depts_transferred int := 0;
  v_depts_removed     int := 0;
  v_shifts_transferred int := 0;
  v_notifs_deleted    int := 0;
  v_step              text := 'validation';
BEGIN
  -- ────────────────────────────────────────────────────────
  -- 0. Validate inputs
  -- ────────────────────────────────────────────────────────
  SELECT role, full_name INTO v_coord_role, v_coord_name
    FROM public.profiles WHERE id = p_coordinator_id;

  IF v_coord_role IS NULL THEN
    RETURN jsonb_build_object(
      'success', false, 'step', v_step,
      'error', 'Coordinator profile not found.');
  END IF;

  IF v_coord_role != 'coordinator' THEN
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
    -- Is there another coordinator for this department?
    SELECT dc.coordinator_id INTO v_other_coord_id
      FROM public.department_coordinators dc
     WHERE dc.department_id = v_dept.department_id
       AND dc.coordinator_id != p_coordinator_id
     LIMIT 1;

    IF v_other_coord_id IS NULL THEN
      -- No other coordinator → assign admin as interim
      INSERT INTO public.department_coordinators (coordinator_id, department_id)
      VALUES (p_admin_id, v_dept.department_id)
      ON CONFLICT (coordinator_id, department_id) DO NOTHING;
      v_depts_transferred := v_depts_transferred + 1;
    ELSE
      -- Another coordinator exists → just remove this one (no orphan)
      v_depts_removed := v_depts_removed + 1;
    END IF;
  END LOOP;

  -- Remove the coordinator from all departments explicitly
  -- (CASCADE would do this, but being explicit keeps the ordering clear)
  DELETE FROM public.department_coordinators
   WHERE coordinator_id = p_coordinator_id;

  -- ────────────────────────────────────────────────────────
  -- 2. Shift ownership transfer
  -- ────────────────────────────────────────────────────────
  v_step := 'shift_transfer';

  UPDATE public.shifts s
     SET created_by  = COALESCE(
           -- Prefer another coordinator already assigned to the department
           (SELECT dc.coordinator_id
              FROM public.department_coordinators dc
             WHERE dc.department_id = s.department_id
               AND dc.coordinator_id != p_coordinator_id
             LIMIT 1),
           -- Fallback: the admin performing the delete
           p_admin_id
         ),
         updated_at = now()
   WHERE s.created_by = p_coordinator_id;

  GET DIAGNOSTICS v_shifts_transferred = ROW_COUNT;

  -- ────────────────────────────────────────────────────────
  -- 3. Reassign / nullify all remaining NO-ACTION FKs
  --    so the profile row can be deleted without constraint
  --    violations. Bookings (volunteer rows) are NOT touched.
  -- ────────────────────────────────────────────────────────
  v_step := 'reassign_references';

  -- shift_bookings: coordinator-side columns
  UPDATE public.shift_bookings
     SET coordinator_actioned_by = p_admin_id
   WHERE coordinator_actioned_by = p_coordinator_id;

  UPDATE public.shift_bookings
     SET confirmed_by = p_admin_id
   WHERE confirmed_by = p_coordinator_id;

  -- attendance_disputes
  UPDATE public.attendance_disputes
     SET coordinator_id = p_admin_id
   WHERE coordinator_id = p_coordinator_id;

  -- shift_notes (audit trail — reassign so history is preserved)
  UPDATE public.shift_notes
     SET author_id = p_admin_id
   WHERE author_id = p_coordinator_id;

  -- shift_invitations
  UPDATE public.shift_invitations
     SET invited_by = p_admin_id
   WHERE invited_by = p_coordinator_id;

  -- shift_attachments
  UPDATE public.shift_attachments
     SET uploader_id = p_admin_id
   WHERE uploader_id = p_coordinator_id;

  -- shift_recurrence_rules
  UPDATE public.shift_recurrence_rules
     SET created_by = p_admin_id
   WHERE created_by = p_coordinator_id;

  -- conversations & messages
  UPDATE public.conversations
     SET created_by = p_admin_id
   WHERE created_by = p_coordinator_id;

  UPDATE public.messages
     SET sender_id = p_admin_id
   WHERE sender_id = p_coordinator_id;

  -- confirmation_reminders (transient — just delete)
  DELETE FROM public.confirmation_reminders
   WHERE recipient_id = p_coordinator_id;

  -- admin_action_log (audit)
  UPDATE public.admin_action_log
     SET admin_id = p_admin_id
   WHERE admin_id = p_coordinator_id;

  -- private_note_access_log
  UPDATE public.private_note_access_log
     SET admin_user_id = p_admin_id
   WHERE admin_user_id = p_coordinator_id;

  -- document_types
  UPDATE public.document_types
     SET created_by = p_admin_id
   WHERE created_by = p_coordinator_id;

  -- events & event_registrations
  UPDATE public.events
     SET created_by = p_admin_id
   WHERE created_by = p_coordinator_id;

  DELETE FROM public.event_registrations
   WHERE volunteer_id = p_coordinator_id;

  -- volunteer_shift_reports (coordinator may have self-reported)
  DELETE FROM public.volunteer_shift_reports
   WHERE volunteer_id = p_coordinator_id;

  -- department_restrictions
  UPDATE public.department_restrictions
     SET restricted_by = p_admin_id
   WHERE restricted_by = p_coordinator_id;

  -- shift_bookings where coordinator was also a volunteer
  -- (cancel their own bookings — these are not "other volunteers' bookings")
  DELETE FROM public.shift_bookings
   WHERE volunteer_id = p_coordinator_id;

  -- ────────────────────────────────────────────────────────
  -- 4. Notification cleanup
  --    Delete undelivered (unread) notifications for this
  --    coordinator. Read notifications and notifications
  --    addressed to volunteers are left untouched.
  -- ────────────────────────────────────────────────────────
  v_step := 'notification_cleanup';

  DELETE FROM public.notifications
   WHERE user_id = p_coordinator_id
     AND is_read = false;

  GET DIAGNOSTICS v_notifs_deleted = ROW_COUNT;

  -- ────────────────────────────────────────────────────────
  -- 5. Delete the profile
  --    Remaining CASCADE FKs (notifications read, mfa_backup_codes,
  --    volunteer_documents, conversation_participants, etc.)
  --    are cleaned up automatically by the cascade.
  -- ────────────────────────────────────────────────────────
  v_step := 'delete_profile';

  DELETE FROM public.profiles WHERE id = p_coordinator_id;

  RETURN jsonb_build_object(
    'success',                true,
    'coordinator_name',       v_coord_name,
    'departments_transferred', v_depts_transferred,
    'departments_removed',     v_depts_removed,
    'shifts_transferred',      v_shifts_transferred,
    'notifications_deleted',   v_notifs_deleted
  );

EXCEPTION WHEN OTHERS THEN
  -- Any failure → whole transaction rolls back automatically
  RETURN jsonb_build_object(
    'success', false,
    'step',    v_step,
    'error',   SQLERRM
  );
END;
$fn$;
