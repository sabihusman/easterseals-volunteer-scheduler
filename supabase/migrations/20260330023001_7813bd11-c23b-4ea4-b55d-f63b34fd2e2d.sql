-- Drop the overly permissive coordinator read policy
DROP POLICY IF EXISTS "profiles: coordinator read volunteers" ON public.profiles;

-- Create a scoped policy: coordinators can only read volunteer profiles
-- for volunteers who have bookings in departments the coordinator is assigned to
CREATE POLICY "profiles: coordinator read dept volunteers"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.department_coordinators dc
    JOIN public.shifts s ON s.department_id = dc.department_id
    JOIN public.shift_bookings sb ON sb.shift_id = s.id
    WHERE dc.coordinator_id = auth.uid()
      AND sb.volunteer_id = profiles.id
  )
);