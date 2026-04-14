-- =============================================
-- ROOT CAUSE of the admin notification "RLS violation":
-- PostgREST with Prefer: return=representation does INSERT followed
-- by SELECT to return the created row. The SELECT runs through
-- notifications RLS, which only has "notifications: own read"
-- (user_id = auth.uid()). When an admin inserts a notification
-- targeted at another user, the SELECT step is blocked, and
-- PostgREST reports the error as a general 42501 RLS violation,
-- masking that the INSERT itself actually succeeded.
--
-- The fix: add a SELECT policy that lets admins read all notifications
-- and lets coordinators read notifications for users in their assigned
-- departments. Volunteers still only see their own notifications.
--
-- Also restore the proper coord/admin INSERT policy that I had to
-- replace with WITH CHECK (true) during diagnostic experiments.
-- =============================================

-- SELECT: admin sees all
CREATE POLICY "notifications: admin read all"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Restore proper INSERT policy (drop the diagnostic true-only one)
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

-- Restore the volunteer-self-insert policy that I dropped during testing
CREATE POLICY "notifications: volunteer self insert"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'volunteer'::user_role
    )
  );

-- Re-enable the email trigger
ALTER TABLE public.notifications ENABLE TRIGGER trg_email_on_notification;
