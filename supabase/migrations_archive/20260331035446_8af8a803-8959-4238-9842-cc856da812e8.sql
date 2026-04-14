CREATE POLICY "reports: coord/admin insert"
  ON public.volunteer_shift_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_coordinator_or_admin());