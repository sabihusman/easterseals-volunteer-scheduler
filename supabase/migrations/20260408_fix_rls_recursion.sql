-- =============================================
-- Fix: the "shifts: read booked" RLS policy I added in
-- 20260408_shift_read_booked.sql introduced infinite recursion.
-- Chain:
--   profiles "coordinator read dept volunteers" -> shift_bookings
--     -> shifts
--   shifts "read booked"                         -> shift_bookings
--   shift_bookings "coordinator dept"            -> shifts
-- Any query that evaluated both chains entered an infinite loop.
-- Profile fetches started returning 500 and the whole UI got
-- stuck on a "Loading..." screen.
--
-- Fix: replace the subquery in the policy with a SECURITY DEFINER
-- function. SECURITY DEFINER bypasses RLS inside, so the function
-- reads shift_bookings directly without re-triggering any policy.
-- =============================================

CREATE OR REPLACE FUNCTION public.has_active_booking_on(p_shift_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.shift_bookings
    WHERE shift_id = p_shift_id
      AND volunteer_id = auth.uid()
      AND booking_status IN ('confirmed', 'waitlisted')
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_active_booking_on(uuid) TO authenticated;

DROP POLICY IF EXISTS "shifts: read booked" ON public.shifts;
CREATE POLICY "shifts: read booked"
  ON public.shifts FOR SELECT
  TO authenticated
  USING (public.has_active_booking_on(id));
