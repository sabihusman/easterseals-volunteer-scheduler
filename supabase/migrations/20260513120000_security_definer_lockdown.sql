-- Phase 2 lockdown: SECURITY DEFINER grant tightening + search_path
-- re-pins + score_shifts_for_volunteer caller check.
--
-- Source: 2026-05-13 Supabase Security Advisor sweep. Full triage and
-- per-function rationale: GitHub issue #194. Hotfix that closed two
-- active vulnerabilities (transfer_admin_role,
-- transfer_coordinator_and_delete) landed in PR #195
-- (20260513000000_harden_transfer_admin_functions.sql) — this
-- migration does NOT re-touch those two.
--
-- ─── What this migration does ──────────────────────────────────────
--
-- 1. Re-pins search_path on 7 trigger functions that were pinned by
--    20260414000001_fix_security_advisor.sql but lost the SET clause
--    when subsequent migrations rewrote their bodies via
--    CREATE OR REPLACE FUNCTION (which silently strips function-level
--    SET clauses).
--
-- 2. REVOKEs EXECUTE FROM PUBLIC, anon, authenticated on:
--      • Every trigger function (return type `trigger`). Triggers are
--        fired by Postgres through the trigger plan; they never need
--        a REST-callable grant.
--      • pg_cron callbacks and internal maintenance helpers. These
--        run as the cron job owner / service_role, not via REST.
--      • Internal recompute helpers invoked only from other functions
--        / triggers (promote_next_waitlist, update_volunteer_preferences).
--      • export_critical_data — full-dump function that had no auth
--        check on the body and was anon-callable. The advisor sweep's
--        worst confidentiality finding.
--
-- 3. REVOKEs FROM PUBLIC, anon and GRANTs TO authenticated on:
--      • Admin RPCs whose body already has an internal role check
--        (is_admin / is_coordinator_or_admin). Grant tightening is
--        defence-in-depth; the body check is the authoritative gate.
--      • Bucket C functions that are legitimately called from the
--        frontend after sign-in but have no anon use case.
--
-- 4. Refactors score_shifts_for_volunteer to reject callers who pass a
--    p_volunteer_id that isn't their own auth.uid() unless they're a
--    coordinator/admin. Pre-fix, any authenticated user could rank
--    another volunteer's recommended shifts (low risk — no PII leaves
--    the function — but "you can rank for any volunteer" is suspicious
--    API shape).
--
-- ─── What this migration does NOT do ───────────────────────────────
--
-- • Touch Bucket B (intentional exposures: is_admin, my_role,
--   username_available, etc.). These MUST stay callable; rationale is
--   documented in CONTRIBUTING.md (this PR's companion change).
--
-- • Touch validate_checkin_token — kiosk check-in flow uses the anon
--   key, so the anon grant is load-bearing.
--
-- • Touch resolve_hours_discrepancy — declared LANGUAGE plpgsql with
--   NO SECURITY DEFINER clause (verified at baseline.sql:1959). It's
--   SECURITY INVOKER and was never on the advisor's list.
--
-- • Touch the transfer_* pair — handled in PR #195 hotfix.
--
-- ─── Idempotency ───────────────────────────────────────────────────
--
-- REVOKE on a grant that doesn't exist is a no-op. GRANT on an
-- existing grant is a no-op. ALTER FUNCTION ... SET search_path
-- overwrites any prior setting. The migration can therefore be safely
-- re-applied after a partial failure.

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 1 — search_path re-pins
-- ═══════════════════════════════════════════════════════════════════
-- Pattern: `ALTER FUNCTION ... SET search_path = public, pg_catalog`
-- matches the canonical form from the April 14 hardening sweep.

ALTER FUNCTION public.cancel_bookings_on_profile_delete()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.enforce_eligibility_on_profile_update()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.enforce_document_request_state_machine()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.set_document_request_expiry()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.enforce_booking_window()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.prevent_overlapping_bookings()
  SET search_path = public, pg_catalog;
ALTER FUNCTION public.prevent_user_from_changing_admin_columns()
  SET search_path = public, pg_catalog;

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 2 — REVOKE EXECUTE FROM PUBLIC, anon, authenticated
--             (triggers, cron callbacks, internal helpers)
-- ═══════════════════════════════════════════════════════════════════
-- service_role retains EXECUTE via its blanket schema-level grant —
-- not affected by these REVOKEs.

-- Triggers (return type `trigger` — invoked by Postgres, never via REST)
REVOKE EXECUTE ON FUNCTION public.cancel_bookings_on_profile_delete()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cascade_bg_check_expiry()                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_attendance_dispute()                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_notifications_for_booking()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_notifications_for_shift()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_self_confirmation_report()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_admin_cap()                        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_admin_only_approval()              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_booking_window()                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_department_restriction()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_document_request_state_machine()   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_eligibility_on_profile_update()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_shift_not_ended_on_booking()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_volunteer_only_booking()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_shift_time_slots()                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_email_on_notification()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_overlapping_bookings()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_role_self_escalation()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_user_from_changing_admin_columns() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.route_minor_booking_to_pending()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_document_request_expiry()              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at()                           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_booked_slots()                        FROM PUBLIC, anon, authenticated;
-- sync_is_minor() was dropped in 20260501000000_remove_dob_capture.sql:77
-- (Half A removed the DOB capture + the BEFORE INSERT/UPDATE trigger that
-- backed it). Intentionally NOT referenced here — referencing a dropped
-- function would fail with SQLSTATE 42883.
REVOKE EXECUTE ON FUNCTION public.sync_slot_booked_count()                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_volunteer_reported_hours()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_recalculate_consistency_fn()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_recalculate_points_fn()                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_update_preferences_on_interaction()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_waitlist_promote_on_cancel()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_waitlist_promote_on_delete()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_shift_status()                      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_booking_slot_count()              FROM PUBLIC, anon, authenticated;

-- pg_cron callbacks + service_role-only operations
REVOKE EXECUTE ON FUNCTION public.admin_emergency_mfa_reset(text)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_mfa_reset(text)                      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_confirmation_reminders()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reconcile_shift_counters()               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.send_self_confirmation_reminders()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.transition_past_shifts_to_completed()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.warn_expiring_documents()                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.export_critical_data()                   FROM PUBLIC, anon, authenticated;

-- Internal recompute helpers (called from other functions / triggers only)
REVOKE EXECUTE ON FUNCTION public.update_volunteer_preferences(uuid)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.promote_next_waitlist(uuid)              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.promote_next_waitlist(uuid, uuid)        FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 3 — REVOKE FROM PUBLIC, anon; GRANT TO authenticated
--             (admin RPCs + Bucket C auth-only RPCs)
-- ═══════════════════════════════════════════════════════════════════

-- Admin RPCs (body already gates on is_admin / is_coordinator_or_admin)
REVOKE EXECUTE ON FUNCTION public.admin_action_off_shift(uuid)               FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_action_off_shift(uuid)               TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_break_glass_read_notes(uuid, text)   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_break_glass_read_notes(uuid, text)   TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_delete_unactioned_shift(uuid)        FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_delete_unactioned_shift(uuid)        TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_update_shift_hours(uuid, numeric)    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_update_shift_hours(uuid, numeric)    TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_unactioned_shifts()                    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_unactioned_shifts()                    TO authenticated;

-- Bucket C — authenticated callers only (frontend RPCs after sign-in)
REVOKE EXECUTE ON FUNCTION public.get_unread_conversation_count()                       FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_unread_conversation_count()                       TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_shift_consistency(uuid[])                         FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_shift_consistency(uuid[])                         TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_shift_popularity(uuid[])                          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_shift_popularity(uuid[])                          TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_shift_rating_aggregates(uuid[])                   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_shift_rating_aggregates(uuid[])                   TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_department_report(uuid[], date, date)             FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_department_report(uuid[], date, date)             TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_other_participants(uuid[])                        FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_other_participants(uuid[])                        TO authenticated;

REVOKE EXECUTE ON FUNCTION public.waitlist_accept(uuid)                                 FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.waitlist_accept(uuid)                                 TO authenticated;

REVOKE EXECUTE ON FUNCTION public.waitlist_decline(uuid)                                FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.waitlist_decline(uuid)                                TO authenticated;

REVOKE EXECUTE ON FUNCTION public.extend_document_request(uuid)                         FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.extend_document_request(uuid)                         TO authenticated;

REVOKE EXECUTE ON FUNCTION public.submit_document(uuid, text, text, text, integer, text, text, text, text, inet, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.submit_document(uuid, text, text, text, integer, text, text, text, text, inet, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.gdpr_erase_document(uuid)                             FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.gdpr_erase_document(uuid)                             TO authenticated;

REVOKE EXECUTE ON FUNCTION public.mfa_consume_backup_code(text)                         FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mfa_consume_backup_code(text)                         TO authenticated;

REVOKE EXECUTE ON FUNCTION public.mfa_generate_backup_codes()                           FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mfa_generate_backup_codes()                           TO authenticated;

REVOKE EXECUTE ON FUNCTION public.mfa_unused_backup_code_count()                        FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mfa_unused_backup_code_count()                        TO authenticated;

REVOKE EXECUTE ON FUNCTION public.shift_end_at(date, time without time zone, text)      FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.shift_end_at(date, time without time zone, text)      TO authenticated;

REVOKE EXECUTE ON FUNCTION public.shift_start_at(date, time without time zone, text)    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.shift_start_at(date, time without time zone, text)    TO authenticated;

REVOKE EXECUTE ON FUNCTION public.recalculate_consistency(uuid)                         FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.recalculate_consistency(uuid)                         TO authenticated;

REVOKE EXECUTE ON FUNCTION public.recalculate_points(uuid)                              FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.recalculate_points(uuid)                              TO authenticated;

-- score_shifts_for_volunteer — refactored below in SECTION 4. Grant
-- tightening happens here so the new definition starts with the
-- correct EXECUTE set.
REVOKE EXECUTE ON FUNCTION public.score_shifts_for_volunteer(uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.score_shifts_for_volunteer(uuid, integer) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- SECTION 4 — score_shifts_for_volunteer caller-identity refactor
-- ═══════════════════════════════════════════════════════════════════
-- Pre-fix: any authenticated caller could pass any volunteer's UUID
-- and rank that volunteer's recommended shifts. Not a confidentiality
-- breach (the function returns shift metadata, scored against a
-- volunteer's history) but the API shape was suspicious.
--
-- Post-fix: a caller can rank shifts for themselves; a coordinator or
-- admin can rank shifts for any volunteer. Anyone else passing a
-- non-self p_volunteer_id gets a 42501.
--
-- Frontend compat: RecommendedShifts.tsx:83-86 always passes
-- p_volunteer_id: user.id, so the check is a no-op for the current UI.

CREATE OR REPLACE FUNCTION public.score_shifts_for_volunteer(
  p_volunteer_id uuid,
  p_max_days     integer
)
RETURNS TABLE(
  shift_id           uuid,
  title              text,
  shift_date         date,
  department_id      uuid,
  department_name    text,
  start_time         time without time zone,
  end_time           time without time zone,
  time_type          text,
  total_slots        integer,
  booked_slots       integer,
  requires_bg_check  boolean,
  fill_rate          numeric,
  preference_score   numeric,
  org_need_score     numeric,
  novelty_score      numeric,
  total_score        numeric,
  score_breakdown    jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_prefs record;
  v_max_interactions numeric;
BEGIN
  -- Caller-identity check. A volunteer can only rank their own
  -- recommended shifts; coordinators and admins can rank for anyone.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required'
      USING ERRCODE = '42501';
  END IF;
  IF auth.uid() <> p_volunteer_id AND NOT public.is_coordinator_or_admin() THEN
    RAISE EXCEPTION 'forbidden: caller may only score their own shifts'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prefs FROM public.volunteer_preferences WHERE volunteer_id = p_volunteer_id;

  SELECT LEAST(COALESCE(MAX(cnt), 1), 50)::numeric INTO v_max_interactions
  FROM (
    SELECT COUNT(*) AS cnt
      FROM public.volunteer_shift_interactions
     WHERE volunteer_id = p_volunteer_id
     GROUP BY volunteer_shift_interactions.shift_id
  ) sub;

  RETURN QUERY
  WITH si AS (
    SELECT vsi.shift_id AS si_shift_id, COUNT(*)::numeric AS interaction_count
      FROM public.volunteer_shift_interactions vsi
     WHERE vsi.volunteer_id = p_volunteer_id
     GROUP BY vsi.shift_id
  ),
  avail AS (
    SELECT
      s.id AS s_id, s.title AS s_title, s.shift_date AS s_date, s.department_id AS s_dept,
      d.name AS d_name, s.start_time AS s_start, s.end_time AS s_end, s.time_type::text AS s_time_type,
      s.total_slots AS s_total, s.booked_slots AS s_booked, s.requires_bg_check AS s_bg,
      COALESCE(si.interaction_count, 0::numeric) AS interactions
    FROM public.shifts s
    JOIN public.departments d ON d.id = s.department_id
    LEFT JOIN si ON si.si_shift_id = s.id
    WHERE s.status = 'open'
      AND s.shift_date >= CURRENT_DATE
      AND s.shift_date <= CURRENT_DATE + (p_max_days || ' days')::interval
      AND s.booked_slots < s.total_slots
      AND NOT EXISTS (
        SELECT 1 FROM public.shift_bookings sb
         WHERE sb.shift_id = s.id
           AND sb.volunteer_id = p_volunteer_id
           AND sb.booking_status = 'confirmed'
      )
  )
  SELECT
    a.s_id, a.s_title, a.s_date, a.s_dept, a.d_name, a.s_start, a.s_end, a.s_time_type,
    a.s_total, a.s_booked, a.s_bg,
    CASE WHEN a.s_total > 0 THEN (a.s_booked::numeric / a.s_total::numeric) ELSE 0::numeric END,
    COALESCE((v_prefs.department_affinity->>(a.s_dept::text))::numeric / 100.0, 0.5::numeric),
    CASE WHEN a.s_total > 0 THEN (1.0 - (a.s_booked::numeric / a.s_total::numeric))::numeric ELSE 0.5::numeric END,
    GREATEST(1.0::numeric - (ln(1.0 + a.interactions)::numeric / ln(1.0 + v_max_interactions)::numeric), 0.3::numeric),
    (
        COALESCE((v_prefs.department_affinity->>(a.s_dept::text))::numeric / 100.0, 0.5::numeric) * 0.5
      + (CASE WHEN a.s_total > 0 THEN (1.0 - (a.s_booked::numeric / a.s_total::numeric))::numeric ELSE 0.5::numeric END) * 0.3
      + GREATEST(1.0::numeric - (ln(1.0 + a.interactions)::numeric / ln(1.0 + v_max_interactions)::numeric), 0.3::numeric) * 0.2
    )::numeric,
    jsonb_build_object(
      'has_history', (SELECT COUNT(*) > 0 FROM public.volunteer_shift_interactions WHERE volunteer_id = p_volunteer_id),
      'preference_weight', 0.5, 'org_need_weight', 0.3, 'novelty_weight', 0.2,
      'interactions', a.interactions, 'novelty_floor', 0.3
    )
  FROM avail a
  ORDER BY 16 DESC
  LIMIT 20;
END;
$$;
