-- =============================================================================
-- Security advisor fixes
-- =============================================================================
-- 1. Recreate two SECURITY DEFINER views with security_invoker=true so RLS
--    uses the caller's permissions instead of the view owner's. security_barrier
--    is preserved (blocks leaky predicates).
-- 2. Pin search_path = public, pg_catalog on 42 functions (43 including the
--    overloaded promote_next_waitlist) to block search_path hijacking.
--
-- View bodies are preserved verbatim from the existing definitions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Views: switch to security_invoker
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.shift_fill_rates
  WITH (security_invoker = true, security_barrier = true)
AS
  SELECT id AS shift_id,
         total_slots,
         booked_slots,
         department_id,
         shift_date,
         time_type,
         EXTRACT(dow FROM shift_date) AS day_of_week,
         CASE
           WHEN total_slots = 0 THEN 0::numeric
           ELSE round(booked_slots::numeric / total_slots::numeric, 4)
         END AS fill_ratio
  FROM shifts s
  WHERE status <> 'cancelled'::shift_status
    AND shift_date >= CURRENT_DATE;

CREATE OR REPLACE VIEW public.volunteer_shift_reports_safe
  WITH (security_invoker = true, security_barrier = true)
AS
  SELECT id,
         booking_id,
         volunteer_id,
         self_confirm_status,
         self_reported_hours,
         reminder_sent_at,
         submitted_at,
         created_at,
         updated_at
  FROM volunteer_shift_reports;

-- -----------------------------------------------------------------------------
-- Functions: pin search_path
-- -----------------------------------------------------------------------------

ALTER FUNCTION public.admin_action_off_shift(p_booking_id uuid)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.admin_delete_unactioned_shift(p_booking_id uuid)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.admin_update_shift_hours(p_booking_id uuid, p_hours numeric)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.cancel_bookings_on_profile_delete()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.cascade_bg_check_expiry()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.cleanup_notifications_for_booking()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.cleanup_notifications_for_shift()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.create_self_confirmation_report()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.enforce_admin_cap()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.enforce_booking_window()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.enforce_department_restriction()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.enforce_eligibility_on_profile_update()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.enforce_shift_not_ended_on_booking()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.export_critical_data()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_department_report(dept_uuids uuid[], date_from date, date_to date)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_shift_consistency(shift_uuids uuid[])
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_shift_popularity(shift_uuids uuid[])
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_shift_rating_aggregates(shift_uuids uuid[])
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.get_unactioned_shifts()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.notification_link_booking_id(p_link text)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.prevent_overlapping_bookings()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.prevent_role_self_escalation()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.promote_next_waitlist(p_shift_id uuid)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.promote_next_waitlist(p_shift_id uuid, p_time_slot_id uuid)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.recalculate_points(volunteer_uuid uuid)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.reconcile_shift_counters()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.resolve_hours_discrepancy(p_booking_id uuid)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.score_shifts_for_volunteer(p_volunteer_id uuid, p_max_days integer)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.send_self_confirmation_reminders()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.shift_end_at(p_shift_date date, p_end_time time without time zone, p_time_type text)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.shift_start_at(p_shift_date date, p_start_time time without time zone, p_time_type text)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.sync_is_minor()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.sync_volunteer_reported_hours()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.transfer_admin_role(from_admin_id uuid, to_coordinator_id uuid)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.trg_recalculate_consistency_fn()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.trg_recalculate_points_fn()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.trg_update_preferences_on_interaction()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.trg_waitlist_promote_on_cancel()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.trg_waitlist_promote_on_delete()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_shift_status()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.update_volunteer_preferences(p_volunteer_id uuid)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.waitlist_accept(p_booking_id uuid)
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.waitlist_decline(p_booking_id uuid)
  SET search_path = public, pg_catalog;
