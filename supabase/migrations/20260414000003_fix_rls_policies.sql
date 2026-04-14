-- Tighten service-role RLS policies to scope TO service_role instead of
-- gating on request.jwt.claims. service_role bypasses RLS, so USING/WITH CHECK
-- can be true; the role-scoping is what enforces the restriction.

DROP POLICY IF EXISTS "Service role can insert logs" ON public.admin_action_log;

CREATE POLICY "Service role can insert logs"
  ON public.admin_action_log
  FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "preferences: system update" ON public.volunteer_preferences;

CREATE POLICY "preferences: system update"
  ON public.volunteer_preferences
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "preferences: system upsert" ON public.volunteer_preferences;

CREATE POLICY "preferences: system upsert"
  ON public.volunteer_preferences
  FOR INSERT
  TO service_role
  WITH CHECK (true);
