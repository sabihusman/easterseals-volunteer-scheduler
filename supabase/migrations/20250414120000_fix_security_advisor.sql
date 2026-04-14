-- =============================================================================
-- Migration: fix_security_advisor
-- Description: Address Supabase Security Advisor findings
--   1. Pin search_path on all SECURITY DEFINER functions missing it
--   2. Add security_barrier to shift_fill_rates view
--   3. Tighten overly permissive RLS policies (service_role only)
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. SECURITY DEFINER functions — pin search_path
-- =============================================================================
-- Every SECURITY DEFINER function must have search_path pinned to prevent
-- malicious schema injection. Two functions (log_mfa_reset,
-- admin_emergency_mfa_reset) already have it set correctly and are skipped.
-- citext extension functions are also skipped (owned by the extension).

ALTER FUNCTION public.trg_recalculate_consistency_fn()
  SET search_path = public;

ALTER FUNCTION public.get_shift_rating_aggregates(uuid[])
  SET search_path = public;

ALTER FUNCTION public.transfer_admin_role(uuid, uuid)
  SET search_path = public;

ALTER FUNCTION public.enforce_eligibility_on_profile_update()
  SET search_path = public;

ALTER FUNCTION public.export_critical_data()
  SET search_path = public;

ALTER FUNCTION public.get_shift_popularity(uuid[])
  SET search_path = public;

ALTER FUNCTION public.sync_volunteer_reported_hours()
  SET search_path = public;

ALTER FUNCTION public.score_shifts_for_volunteer(uuid, integer)
  SET search_path = public;

ALTER FUNCTION public.get_shift_consistency(uuid[])
  SET search_path = public;

ALTER FUNCTION public.trg_update_preferences_on_interaction()
  SET search_path = public;

ALTER FUNCTION public.update_volunteer_preferences(uuid)
  SET search_path = public;

ALTER FUNCTION public.get_department_report(uuid[], date, date)
  SET search_path = public;

ALTER FUNCTION public.trg_recalculate_points_fn()
  SET search_path = public;

ALTER FUNCTION public.recalculate_points(uuid)
  SET search_path = public;

ALTER FUNCTION public.cascade_bg_check_expiry()
  SET search_path = public;

ALTER FUNCTION public.create_self_confirmation_report()
  SET search_path = public;

ALTER FUNCTION public.send_self_confirmation_reminders()
  SET search_path = public;

ALTER FUNCTION public.get_unactioned_shifts()
  SET search_path = public;

ALTER FUNCTION public.waitlist_accept(uuid)
  SET search_path = public;

ALTER FUNCTION public.admin_delete_unactioned_shift(uuid)
  SET search_path = public;

ALTER FUNCTION public.admin_update_shift_hours(uuid, numeric)
  SET search_path = public;

ALTER FUNCTION public.admin_action_off_shift(uuid)
  SET search_path = public;

ALTER FUNCTION public.promote_next_waitlist(uuid)
  SET search_path = public;

ALTER FUNCTION public.promote_next_waitlist(uuid, uuid)
  SET search_path = public;

ALTER FUNCTION public.reconcile_shift_counters()
  SET search_path = public;

ALTER FUNCTION public.waitlist_decline(uuid)
  SET search_path = public;


-- =============================================================================
-- 2. VIEW security_barrier — shift_fill_rates
-- =============================================================================
-- volunteer_shift_reports_safe already has security_barrier=true.
-- shift_fill_rates is missing it — recreate with the flag.

CREATE OR REPLACE VIEW public.shift_fill_rates
  WITH (security_barrier = true)
  AS
  SELECT id AS shift_id,
    total_slots,
    booked_slots,
    department_id,
    shift_date,
    time_type,
    EXTRACT(dow FROM shift_date) AS day_of_week,
    CASE
      WHEN (total_slots = 0) THEN (0)::numeric
      ELSE round(((booked_slots)::numeric / (total_slots)::numeric), 4)
    END AS fill_ratio
  FROM shifts s
  WHERE ((status <> 'cancelled'::shift_status) AND (shift_date >= CURRENT_DATE));


-- =============================================================================
-- 3. RLS policies — tighten overly permissive checks
-- =============================================================================
-- These three policies use bare `true` as their USING or WITH CHECK expression,
-- which means any authenticated role can hit them. They should be restricted to
-- the service_role only (used by Edge Functions / pg_cron / server-side calls).

-- 3a. "preferences: system update" on volunteer_preferences
DROP POLICY "preferences: system update" ON public.volunteer_preferences;
CREATE POLICY "preferences: system update" ON public.volunteer_preferences
  FOR UPDATE
  USING ((current_setting('request.jwt.claims', true)::json ->> 'role') = 'service_role')
  WITH CHECK ((current_setting('request.jwt.claims', true)::json ->> 'role') = 'service_role');

-- 3b. "preferences: system upsert" on volunteer_preferences
DROP POLICY "preferences: system upsert" ON public.volunteer_preferences;
CREATE POLICY "preferences: system upsert" ON public.volunteer_preferences
  FOR INSERT
  WITH CHECK ((current_setting('request.jwt.claims', true)::json ->> 'role') = 'service_role');

-- 3c. "Service role can insert logs" on admin_action_log
-- NOTE: earlier draft referenced public.audit_logs, which does not
-- exist. The policy lives on public.admin_action_log (baseline line 4598).
DROP POLICY "Service role can insert logs" ON public.admin_action_log;
CREATE POLICY "Service role can insert logs" ON public.admin_action_log
  FOR INSERT
  WITH CHECK ((current_setting('request.jwt.claims', true)::json ->> 'role') = 'service_role');

COMMIT;
