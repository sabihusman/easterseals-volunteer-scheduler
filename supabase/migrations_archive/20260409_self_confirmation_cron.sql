-- =============================================
-- Fix: volunteers receive no notification to confirm their
-- attendance after a shift ends. The self_confirmation_reminder
-- email template exists but no cron job ever creates the
-- notification. The existing unactioned-shift-volunteer-reminder
-- only fires 12-48 hours after shift end — too late.
--
-- This cron runs every 30 minutes and creates a
-- self_confirmation_reminder notification for bookings where:
--   * booking_status = 'confirmed'
--   * confirmation_status = 'pending_confirmation'
--   * shift has ended (within the last 6 hours)
--   * no self_confirmation_reminder already sent for this booking
--
-- The notification includes a link to /my-shifts/confirm/:bookingId
-- so the volunteer can log hours and rate the shift.
-- =============================================

SELECT cron.unschedule('self-confirmation-reminder')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'self-confirmation-reminder');

SELECT cron.schedule(
  'self-confirmation-reminder',
  '*/30 * * * *',
  $cron$
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
  $cron$
);
