-- =============================================
-- BUG: notifications has RLS policies for authenticated users to INSERT
-- (notifications: volunteer self insert, notifications: coord/admin insert)
-- but the table-level GRANT to the authenticated role was missing.
-- Without GRANT INSERT, PostgreSQL rejects the operation with the same
-- 42501 "row-level security policy violation" error code BEFORE evaluating
-- the RLS policies.
--
-- This silently broke every authenticated insert into notifications:
--   - Admin hard-delete shift "notify volunteers" path
--   - Volunteer self-insert (e.g. self_no_show toast notification)
--   - Coordinator manual notification flows
--
-- Restore the v8 fixes by also restoring the original policy after the
-- diagnostic experiments earlier in this QA session.
-- =============================================

GRANT INSERT ON public.notifications TO authenticated;

-- Restore the email trigger if it was disabled during diagnostics
ALTER TABLE public.notifications ENABLE TRIGGER trg_email_on_notification;

-- Restore the proper coord/admin insert policy (drop the diagnostic
-- "always allow" and "admin insert" policies left over from this session)
DROP POLICY IF EXISTS "notifications: always allow" ON public.notifications;
DROP POLICY IF EXISTS "notifications: admin insert" ON public.notifications;
DROP POLICY IF EXISTS "notifications: coord/admin insert" ON public.notifications;

CREATE POLICY "notifications: coord/admin insert"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin()
    OR (
      public.is_coordinator_or_admin()
      AND (
        EXISTS (
          SELECT 1
          FROM profiles p
          JOIN shift_bookings sb ON sb.volunteer_id = p.id
          JOIN shifts s ON s.id = sb.shift_id
          JOIN department_coordinators dc ON dc.department_id = s.department_id
          WHERE p.id = notifications.user_id AND dc.coordinator_id = auth.uid()
        )
        OR user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.id = notifications.user_id AND p.role = 'admin'::user_role
        )
      )
    )
  );
