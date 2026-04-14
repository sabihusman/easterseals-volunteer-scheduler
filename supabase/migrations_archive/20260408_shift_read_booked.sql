-- =============================================
-- Fix: the "shifts: all read open" policy hides shifts whose
-- start_time is within 2 hours of now (intended to prevent
-- last-minute browsing). But when a volunteer already has an
-- active booking on such a shift, they need to see it on their
-- dashboard — RLS on shifts was hiding it and the embed returned
-- null, so Test 1/Test 2 disappeared from "Upcoming Shifts" as
-- the start time approached.
--
-- Add an additional SELECT policy: volunteers can always read
-- shifts they have a confirmed or waitlisted booking on,
-- regardless of the time-window rule in the other policy.
-- PostgreSQL ORs permissive policies, so this only expands
-- access, it doesn't open up browsing.
-- =============================================
DROP POLICY IF EXISTS "shifts: read booked" ON public.shifts;
CREATE POLICY "shifts: read booked"
  ON public.shifts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shift_bookings sb
      WHERE sb.shift_id = shifts.id
        AND sb.volunteer_id = auth.uid()
        AND sb.booking_status IN ('confirmed', 'waitlisted')
    )
  );
