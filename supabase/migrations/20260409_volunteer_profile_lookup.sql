-- =============================================
-- Fix: volunteers can't look up staff when composing a message.
--
-- Symptom: a volunteer opens the "New Message" dialog, types a name
-- or email, and nothing appears — including the admin and the
-- coordinator of departments they've actually booked shifts in.
--
-- Root cause: the profiles RLS policies grant read access to:
--   (a) the user's own profile
--   (b) admins (read all)
--   (c) coordinators (read volunteers in their departments)
--
-- There is no policy that lets a volunteer read anyone else's
-- profile — not admins, not coordinators. So `supabase.from("profiles")
-- .select(...).in("role", ["coordinator","admin"])` returns an empty
-- set for volunteers, and the compose typeahead has nothing to match.
--
-- Fix: add a SELECT policy for authenticated users that exposes:
--   * every admin profile (admins serve the whole org, and volunteers
--     should always be able to message them)
--   * coordinator profiles whose department has a current or past
--     booking by the requesting user
--
-- RLS recursion safety: the coordinator scoping joins
-- department_coordinators + shifts + shift_bookings. To keep the
-- policy evaluation from re-entering any policy on those tables
-- (which caused the 20260408_fix_rls_recursion incident), the join
-- is wrapped in a SECURITY DEFINER helper function that bypasses
-- RLS during its own query.
-- =============================================

CREATE OR REPLACE FUNCTION public.is_coordinator_for_my_dept(p_coordinator_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.department_coordinators dc
    JOIN public.shifts s             ON s.department_id = dc.department_id
    JOIN public.shift_bookings sb    ON sb.shift_id = s.id
    WHERE dc.coordinator_id = p_coordinator_id
      AND sb.volunteer_id   = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_coordinator_for_my_dept(uuid) TO authenticated;

-- Idempotent policy creation
DROP POLICY IF EXISTS "profiles: volunteer read admins and dept coordinators" ON public.profiles;

CREATE POLICY "profiles: volunteer read admins and dept coordinators"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  role = 'admin'
  OR (role = 'coordinator' AND public.is_coordinator_for_my_dept(id))
);
