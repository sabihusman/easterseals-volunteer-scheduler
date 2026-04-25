-- ===========================================================================
-- Export of pg_cron jobs that previously lived only in the Supabase dashboard.
-- ===========================================================================
--
-- Background: 14 of 15 active pg_cron jobs were created interactively in the
-- Supabase SQL editor and never folded into version control, so a fresh
-- Supabase project couldn't reproduce the schedule. Tracked in #116.
--
-- This migration exports 13 of those 14 jobs verbatim (matched to the live
-- production state on 2026-04-24) and explicitly unschedules the 14th —
-- `expire-documents-daily` — which has been failing every morning at 07:00
-- UTC since at least 2026-04-20 because the function it calls
-- (`expire_documents()`) was never created. The "mark expired" behavior is
-- already covered as Step 2 of `warn_expiring_documents()` (see baseline
-- migration line 2996), which runs daily at 13:00. The 07:00 cron is dead
-- code; #121 tracks the design-intent decision of whether to revive it.
--
-- The job already in version control — `shift-status-transition`, scheduled
-- by `20260415000000_shift_lifecycle_rules.sql` — is intentionally NOT
-- repeated here.
--
-- Idempotency: every job is unscheduled-if-exists then scheduled, so this
-- migration is safe to apply against environments where some/all jobs
-- already exist (production, staging, or a fresh project).
--
-- Apply with:
--   supabase db push --linked
-- (CI does not auto-apply SQL changes — by design, see OPERATIONS_RUNBOOK.md.)
-- ===========================================================================

DO $migration$
BEGIN

  -- =========================================================================
  -- 1. dispute-auto-resolve  (hourly at :17)
  -- Auto-resolves attendance disputes >7 days old in favor of the volunteer.
  -- =========================================================================
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dispute-auto-resolve') THEN
    PERFORM cron.unschedule('dispute-auto-resolve');
  END IF;
  PERFORM cron.schedule('dispute-auto-resolve', '17 * * * *', $$
  WITH resolved AS (
    UPDATE public.attendance_disputes ad
    SET admin_decision = 'volunteer_upheld', resolved_by = 'auto_timeout',
        final_hours_awarded = COALESCE(ad.volunteer_reported_hours, 0), admin_decided_at = now()
    WHERE ad.admin_decision IS NULL AND now() > ad.expires_at
    RETURNING ad.booking_id, ad.volunteer_id, ad.coordinator_id, ad.shift_id, ad.volunteer_reported_hours
  ),
  booking_updates AS (
    UPDATE public.shift_bookings sb
    SET confirmation_status = 'confirmed', final_hours = COALESCE(r.volunteer_reported_hours, 0),
        hours_source = 'dispute_auto_resolved', updated_at = now()
    FROM resolved r WHERE sb.id = r.booking_id RETURNING sb.id
  ),
  vol_notifs AS (
    INSERT INTO public.notifications (user_id, type, title, message, link, is_read)
    SELECT r.volunteer_id, 'dispute_resolved', 'Attendance confirmed',
      'Your attendance for "' || s.title || '" on ' || to_char(s.shift_date, 'Mon DD') ||
        ' has been confirmed. Hours awarded: ' || COALESCE(r.volunteer_reported_hours, 0) || 'h.',
      '/history', false
    FROM resolved r JOIN public.shifts s ON s.id = r.shift_id RETURNING user_id
  )
  INSERT INTO public.notifications (user_id, type, title, message, link, is_read)
  SELECT r.coordinator_id, 'dispute_resolved', 'Dispute auto-resolved',
    'The attendance dispute for a volunteer on "' || s.title ||
      '" was auto-resolved in favor of the volunteer after 7 days without admin review.',
    '/coordinator', false
  FROM resolved r JOIN public.shifts s ON s.id = r.shift_id;
  $$);

  -- =========================================================================
  -- 2. expire-shift-invitations  (every 15 min)
  -- Marks unaccepted shift invitations past their expires_at as 'expired'.
  -- =========================================================================
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-shift-invitations') THEN
    PERFORM cron.unschedule('expire-shift-invitations');
  END IF;
  PERFORM cron.schedule('expire-shift-invitations', '*/15 * * * *', $$
    UPDATE public.shift_invitations
       SET status = 'expired'
     WHERE status = 'pending'
       AND expires_at < now();
  $$);

  -- =========================================================================
  -- 3. prune-read-notifications  (daily at 08:00 UTC)
  -- Deletes notifications that are read AND older than 90 days.
  -- =========================================================================
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-read-notifications') THEN
    PERFORM cron.unschedule('prune-read-notifications');
  END IF;
  PERFORM cron.schedule('prune-read-notifications', '0 8 * * *', $$
  DELETE FROM public.notifications
  WHERE is_read = true
    AND created_at < now() - interval '90 days';
  $$);

  -- =========================================================================
  -- 4. reconcile-shift-counters  (daily at 09:00 UTC)
  -- Recomputes shifts.booked_slots from shift_bookings row counts in case a
  -- trigger ever miscounted. Function defined in baseline migration.
  -- =========================================================================
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-shift-counters') THEN
    PERFORM cron.unschedule('reconcile-shift-counters');
  END IF;
  PERFORM cron.schedule('reconcile-shift-counters', '0 9 * * *', $$SELECT public.reconcile_shift_counters();$$);

  -- =========================================================================
  -- 5. rotate-checkin-tokens  (hourly)
  -- Expires checkin_tokens past their rotation window and creates a single
  -- replacement if none active.
  -- =========================================================================
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rotate-checkin-tokens') THEN
    PERFORM cron.unschedule('rotate-checkin-tokens');
  END IF;
  PERFORM cron.schedule('rotate-checkin-tokens', '0 * * * *', $$
    -- Expire tokens that have exceeded their rotation window
    UPDATE public.checkin_tokens
       SET is_active = false,
           expires_at = COALESCE(expires_at, now())
     WHERE is_active = true
       AND rotation_mode != 'none'
       AND (
         (rotation_mode = 'daily'   AND created_at < now() - interval '1 day')
         OR (rotation_mode = 'weekly'  AND created_at < now() - interval '1 week')
         OR (rotation_mode = 'monthly' AND created_at < now() - interval '1 month')
       );

    -- Create replacement tokens for any that were just expired,
    -- but only if there's no other active token already.
    INSERT INTO public.checkin_tokens (token, is_active, rotation_mode)
    SELECT gen_random_uuid()::text, true, ct.rotation_mode
      FROM public.checkin_tokens ct
     WHERE ct.is_active = false
       AND ct.expires_at >= now() - interval '1 hour'
       AND ct.rotation_mode != 'none'
       AND NOT EXISTS (
         SELECT 1 FROM public.checkin_tokens ct2
          WHERE ct2.is_active = true
       )
     LIMIT 1;
  $$);

  -- =========================================================================
  -- 6. self-confirmation-reminder  (every 30 min)
  -- Nudges volunteers to self-confirm attendance for shifts that ended
  -- within the last 6 hours; idempotent via NOT EXISTS notification check.
  -- =========================================================================
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'self-confirmation-reminder') THEN
    PERFORM cron.unschedule('self-confirmation-reminder');
  END IF;
  PERFORM cron.schedule('self-confirmation-reminder', '*/30 * * * *', $$
  INSERT INTO public.notifications (user_id, type, title, message, link, is_read, data)
  SELECT
    sb.volunteer_id,
    'self_confirmation_reminder',
    'Please confirm: ' || s.title,
    'Your shift "' || s.title || '" on ' || to_char(s.shift_date, 'Mon DD') ||
      ' has ended. Please confirm your attendance and log your hours.',
    '/my-shifts/confirm/' || sb.id,
    false,
    jsonb_build_object(
      'booking_id', sb.id,
      'shift_id', s.id,
      'shift_title', s.title,
      'shift_date', s.shift_date,
      'start_time', s.start_time,
      'end_time', s.end_time
    )
  FROM public.shift_bookings sb
  JOIN public.shifts s ON s.id = sb.shift_id
  WHERE sb.booking_status = 'confirmed'
    AND sb.confirmation_status = 'pending_confirmation'
    -- Only for shifts that ended within the last 6 hours (don't
    -- spam for very old shifts — the unactioned-shift reminders
    -- handle the 12h+ window)
    AND public.shift_end_at(s.shift_date, s.end_time, s.time_type::text)
        BETWEEN now() - interval '6 hours' AND now()
    -- Don't duplicate: skip if a self_confirmation_reminder was
    -- already sent for this booking
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = sb.volunteer_id
        AND n.type = 'self_confirmation_reminder'
        AND (n.data->>'booking_id')::uuid = sb.id
    );
  $$);

  -- =========================================================================
  -- 7. shift-reminder-24h  (hourly at :00)
  -- Sends 24-hour-before reminders for upcoming shifts.
  -- (Body normalized to LF line endings per export.)
  -- =========================================================================
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'shift-reminder-24h') THEN
    PERFORM cron.unschedule('shift-reminder-24h');
  END IF;
  PERFORM cron.schedule('shift-reminder-24h', '0 * * * *', $$
  INSERT INTO notifications (user_id, type, title, message, data)
  SELECT sb.volunteer_id, 'shift_reminder_auto',
    'Reminder: ' || s.title || ' is tomorrow',
    'Your shift starts at ' || to_char(s.shift_date, 'Mon DD') || ' at ' || to_char((s.start_time)::time, 'HH12:MI AM') || ' at ' || coalesce(l.name, 'the scheduled location') || '.',
    jsonb_build_object('shift_id', s.id, 'shift_title', s.title, 'shift_date', s.shift_date, 'start_time', s.start_time, 'location_name', l.name, 'location_address', l.address, 'coordinator_note', s.coordinator_note)
  FROM shift_bookings sb
  JOIN shifts s ON sb.shift_id = s.id
  LEFT JOIN departments d ON s.department_id = d.id
  LEFT JOIN locations l ON d.location_id = l.id
  WHERE sb.booking_status = 'confirmed' AND s.shift_date = current_date + interval '1 day'
    AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = sb.volunteer_id AND n.type = 'shift_reminder_auto' AND (n.data->>'shift_id')::uuid = s.id AND n.created_at > now() - interval '20 hours');
  $$);

  -- =========================================================================
  -- 8. shift-reminder-2h  (hourly at :30)
  -- Sends 2-hour-before reminders. Window check uses America/Chicago hour.
  -- (Body normalized to LF line endings per export.)
  -- =========================================================================
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'shift-reminder-2h') THEN
    PERFORM cron.unschedule('shift-reminder-2h');
  END IF;
  PERFORM cron.schedule('shift-reminder-2h', '30 * * * *', $$
  INSERT INTO notifications (user_id, type, title, message, data)
  SELECT sb.volunteer_id, 'shift_reminder_auto',
    s.title || ' starts in 2 hours',
    'Head out soon — your shift starts at ' || to_char((s.start_time)::time, 'HH12:MI AM') || ' at ' || coalesce(l.name, 'the scheduled location') || '.',
    jsonb_build_object('shift_id', s.id, 'shift_title', s.title, 'shift_date', s.shift_date, 'start_time', s.start_time, 'location_name', l.name, 'location_address', l.address, 'coordinator_note', s.coordinator_note)
  FROM shift_bookings sb
  JOIN shifts s ON sb.shift_id = s.id
  LEFT JOIN departments d ON s.department_id = d.id
  LEFT JOIN locations l ON d.location_id = l.id
  WHERE sb.booking_status = 'confirmed' AND s.shift_date = current_date
    AND extract(hour from (s.start_time::time)) BETWEEN extract(hour from now() at time zone 'America/Chicago') + 1 AND extract(hour from now() at time zone 'America/Chicago') + 3
    AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = sb.volunteer_id AND n.type = 'shift_reminder_auto' AND (n.data->>'shift_id')::uuid = s.id AND n.created_at > now() - interval '1 hour');
  $$);

  -- =========================================================================
  -- 9. unactioned-shift-auto-delete  (daily at 08:00 UTC)
  -- No-shows the booking for shifts unconfirmed >7 days after end.
  -- =========================================================================
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'unactioned-shift-auto-delete') THEN
    PERFORM cron.unschedule('unactioned-shift-auto-delete');
  END IF;
  PERFORM cron.schedule('unactioned-shift-auto-delete', '0 8 * * *', $$
  UPDATE public.shift_bookings sb
  SET confirmation_status = 'no_show', updated_at = now()
  FROM public.shifts s
  WHERE sb.shift_id = s.id
    AND sb.booking_status = 'confirmed'
    AND sb.confirmation_status = 'pending_confirmation'
    AND sb.coordinator_status IS NULL
    AND public.shift_end_at(s.shift_date, s.end_time, s.time_type::text) < now() - interval '7 days'
    AND sb.checked_in_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.volunteer_shift_reports vsr
      WHERE vsr.booking_id = sb.id AND vsr.submitted_at IS NOT NULL);
  $$);

  -- =========================================================================
  -- 10. unactioned-shift-coordinator-reminder  (daily at 15:00 UTC)
  -- Notifies coordinators when a volunteer hasn't confirmed an ended shift
  -- (48h–7d window).
  -- =========================================================================
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'unactioned-shift-coordinator-reminder') THEN
    PERFORM cron.unschedule('unactioned-shift-coordinator-reminder');
  END IF;
  PERFORM cron.schedule('unactioned-shift-coordinator-reminder', '0 15 * * *', $$
  INSERT INTO public.notifications (user_id, type, title, message, data, is_read)
  SELECT
    dc.coordinator_id,
    'unactioned_shift_coord_reminder',
    'Volunteer has not confirmed: ' || s.title,
    p.full_name || ' has not checked in or confirmed their shift "' || s.title ||
      '" on ' || to_char(s.shift_date, 'Mon DD') ||
      '. Please follow up or action it off in the admin panel.',
    jsonb_build_object(
      'booking_id', sb.id,
      'shift_id', s.id,
      'shift_title', s.title,
      'shift_date', s.shift_date,
      'volunteer_name', p.full_name
    ),
    false
  FROM public.shift_bookings sb
  JOIN public.shifts s ON s.id = sb.shift_id
  JOIN public.profiles p ON p.id = sb.volunteer_id
  JOIN public.department_coordinators dc ON dc.department_id = s.department_id
  WHERE sb.booking_status = 'confirmed'
    AND sb.confirmation_status = 'pending_confirmation'
    AND public.shift_end_at(s.shift_date, s.end_time, s.time_type::text)
        BETWEEN now() - interval '7 days' AND now() - interval '48 hours'
    AND (
      sb.checked_in_at IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.volunteer_shift_reports vsr
        WHERE vsr.booking_id = sb.id AND vsr.submitted_at IS NOT NULL
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = dc.coordinator_id
        AND n.type = 'unactioned_shift_coord_reminder'
        AND (n.data->>'booking_id')::uuid = sb.id
    );
  $$);

  -- =========================================================================
  -- 11. unactioned-shift-volunteer-reminder  (hourly 15:00–22:00 UTC)
  -- Reminds volunteers to confirm shifts whose end was 12–48h ago.
  -- Capped at 2 reminders per booking, with a 12h cooldown between sends.
  -- =========================================================================
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'unactioned-shift-volunteer-reminder') THEN
    PERFORM cron.unschedule('unactioned-shift-volunteer-reminder');
  END IF;
  PERFORM cron.schedule('unactioned-shift-volunteer-reminder', '0 15-22 * * *', $$
  INSERT INTO public.notifications (user_id, type, title, message, data, is_read)
  SELECT
    sb.volunteer_id,
    'unactioned_shift_reminder',
    'Action needed: ' || s.title,
    'Please check in and confirm your shift "' || s.title ||
      '" on ' || to_char(s.shift_date, 'Mon DD') ||
      '. Without this, your volunteer hours won''t be recorded.',
    jsonb_build_object(
      'booking_id', sb.id,
      'shift_id', s.id,
      'shift_title', s.title,
      'shift_date', s.shift_date,
      'checked_in', (sb.checked_in_at IS NOT NULL),
      'actioned_off', (
        EXISTS (SELECT 1 FROM public.volunteer_shift_reports vsr
                WHERE vsr.booking_id = sb.id AND vsr.submitted_at IS NOT NULL)
      )
    ),
    false
  FROM public.shift_bookings sb
  JOIN public.shifts s ON s.id = sb.shift_id
  WHERE sb.booking_status = 'confirmed'
    AND sb.confirmation_status = 'pending_confirmation'
    AND public.shift_end_at(s.shift_date, s.end_time, s.time_type::text)
        BETWEEN now() - interval '48 hours' AND now() - interval '12 hours'
    AND (
      sb.checked_in_at IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.volunteer_shift_reports vsr
        WHERE vsr.booking_id = sb.id AND vsr.submitted_at IS NOT NULL
      )
    )
    AND (
      SELECT COUNT(*) FROM public.notifications n
      WHERE n.user_id = sb.volunteer_id
        AND n.type = 'unactioned_shift_reminder'
        AND (n.data->>'booking_id')::uuid = sb.id
    ) < 2
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = sb.volunteer_id
        AND n.type = 'unactioned_shift_reminder'
        AND (n.data->>'booking_id')::uuid = sb.id
        AND n.created_at > now() - interval '12 hours'
    );
  $$);

  -- =========================================================================
  -- 12. waitlist-offer-expire  (every 5 min)
  -- Expires unaccepted waitlist offers, notifies the volunteer, and promotes
  -- the next person in line via promote_next_waitlist().
  -- =========================================================================
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'waitlist-offer-expire') THEN
    PERFORM cron.unschedule('waitlist-offer-expire');
  END IF;
  PERFORM cron.schedule('waitlist-offer-expire', '*/5 * * * *', $$
  WITH expired AS (
    DELETE FROM public.shift_bookings sb
    WHERE sb.booking_status = 'waitlisted'
      AND sb.waitlist_offer_expires_at IS NOT NULL
      AND sb.waitlist_offer_expires_at < now()
    RETURNING shift_id, volunteer_id, time_slot_id
  ),
  notifs AS (
    INSERT INTO public.notifications (user_id, type, title, message, link, is_read)
    SELECT e.volunteer_id, 'waitlist_offer_expired', 'Waitlist offer expired',
      'You did not respond to the waitlist offer in time. Your spot has been forfeited.',
      '/dashboard', false
    FROM expired e
    RETURNING user_id
  )
  SELECT public.promote_next_waitlist(shift_id, time_slot_id) FROM expired;
  $$);

  -- =========================================================================
  -- 13. warn-expiring-documents-daily  (daily at 13:00 UTC)
  -- Step 1: marks docs expiring within 30 days as 'expiring_soon' (with
  -- volunteer notification). Step 2 (inside the same function): marks
  -- already-expired docs as 'expired'. See baseline migration L2950.
  -- =========================================================================
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'warn-expiring-documents-daily') THEN
    PERFORM cron.unschedule('warn-expiring-documents-daily');
  END IF;
  PERFORM cron.schedule('warn-expiring-documents-daily', '0 13 * * *', $$SELECT public.warn_expiring_documents();$$);

  -- =========================================================================
  -- DEAD CRON: expire-documents-daily
  -- Was scheduled at 0 7 * * * calling SELECT expire_documents() — but the
  -- function was never created. Has been failing nightly since at least
  -- 2026-04-20 ("function expire_documents() does not exist"). The "mark
  -- expired" behavior is already covered as Step 2 of warn_expiring_documents()
  -- (see baseline migration L2996), which runs at 13:00 via the job above.
  -- Unscheduled here so production stops the daily error and fresh projects
  -- never schedule it. Whether to revive a separate 07:00 expiry job is
  -- tracked in #121 — this is a design decision, not a bug fix.
  -- =========================================================================
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-documents-daily') THEN
    PERFORM cron.unschedule('expire-documents-daily');
  END IF;

END $migration$;
