-- =============================================================================
-- Migration: harden_rls_policies
-- Description: Restrict three unrestricted RLS policies flagged by the
--   Supabase Security Advisor. All three policies were written as
--   WITH CHECK (true) / USING (true), meaning any authenticated or anon
--   session could write directly to these tables via the REST API.
--
-- Tables affected:
--   1. admin_action_log  — INSERT policy "Service role can insert logs"
--   2. volunteer_preferences — UPDATE policy "preferences: system update"
--   3. volunteer_preferences — INSERT policy "preferences: system upsert"
--
-- Fix: restrict all three to service_role JWT claim only.
--
-- Safety analysis:
--   • admin_action_log is written exclusively by two edge functions
--     (admin-act-on-behalf, admin-reset-mfa) that use the SERVICE_ROLE_KEY
--     (adminClient). Service-role requests bypass RLS entirely, so the
--     policy is never evaluated for legitimate writes. Restricting it
--     blocks only direct REST API abuse.
--
--   • volunteer_preferences is written exclusively by
--     public.update_volunteer_preferences(), a SECURITY DEFINER function
--     that runs as the postgres role and also bypasses RLS. Restricting
--     the policies does not affect trigger-based writes at all.
--
-- No existing write paths are broken by this change.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. admin_action_log — INSERT policy
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Service role can insert logs" ON public.admin_action_log;

CREATE POLICY "Service role can insert logs"
  ON public.admin_action_log
  FOR INSERT
  WITH CHECK (
    (current_setting('request.jwt.claims', true)::json ->> 'role') = 'service_role'
  );

-- ---------------------------------------------------------------------------
-- 2. volunteer_preferences — UPDATE policy
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "preferences: system update" ON public.volunteer_preferences;

CREATE POLICY "preferences: system update"
  ON public.volunteer_preferences
  FOR UPDATE
  USING (
    (current_setting('request.jwt.claims', true)::json ->> 'role') = 'service_role'
  )
  WITH CHECK (
    (current_setting('request.jwt.claims', true)::json ->> 'role') = 'service_role'
  );

-- ---------------------------------------------------------------------------
-- 3. volunteer_preferences — INSERT policy
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "preferences: system upsert" ON public.volunteer_preferences;

CREATE POLICY "preferences: system upsert"
  ON public.volunteer_preferences
  FOR INSERT
  WITH CHECK (
    (current_setting('request.jwt.claims', true)::json ->> 'role') = 'service_role'
  );
