-- =============================================
-- BUG: notifications coord/admin insert policy has role {-} (PUBLIC / no
-- role restriction). When the volunteer-self-insert policy is restricted
-- TO authenticated, PostgreSQL evaluates only the policies that match
-- the current role. Role `-` is stored differently than `authenticated`,
-- and the result is that admins calling POST /notifications from PostgREST
-- (which runs as `authenticated`) have their INSERT rejected because
-- only the volunteer-self-insert policy applies \u2014 and they aren't
-- volunteers.
--
-- AdminDashboard.handleDeleteShift inserts notifications before
-- hard-deleting a shift to warn affected volunteers. That path was
-- silently broken.
--
-- Fix: recreate the coord/admin insert policy TO authenticated so it
-- applies when the admin is running as the authenticated PostgREST role.
-- =============================================

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
