-- =============================================
-- Fix: the unactioned shifts migration used the wrong enum label
-- ('pending' instead of 'pending_confirmation'). Replaces the three
-- cron jobs and the get_unactioned_shifts RPC with correct values.
-- =============================================

-- Drop and reschedule the three cron jobs
SELECT cron.unschedule('unactioned-shift-volunteer-reminder') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'unactioned-shift-volunteer-reminder'
);
SELECT cron.unschedule('unactioned-shift-coordinator-reminder') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'unactioned-shift-coordinator-reminder'
);
SELECT cron.unschedule('unactioned-shift-auto-delete') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'unactioned-shift-auto-delete'
);

SELECT cron.schedule(
  'unactioned-shift-volunteer-reminder',
  '0 15-22 * * *',
  $cron$
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
  $cron$
);

SELECT cron.schedule(
  'unactioned-shift-coordinator-reminder',
  '0 15 * * *',
  $cron$
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
  $cron$
);

SELECT cron.schedule(
  'unactioned-shift-auto-delete',
  '0 8 * * *',
  $cron$
  DELETE FROM public.shift_bookings sb
  USING public.shifts s
  WHERE sb.shift_id = s.id
    AND sb.booking_status = 'confirmed'
    AND sb.confirmation_status = 'pending_confirmation'
    AND public.shift_end_at(s.shift_date, s.end_time, s.time_type::text) < now() - interval '7 days'
    AND (
      sb.checked_in_at IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.volunteer_shift_reports vsr
        WHERE vsr.booking_id = sb.id AND vsr.submitted_at IS NOT NULL
      )
    );
  $cron$
);

-- Replace the RPC with the correct enum value
CREATE OR REPLACE FUNCTION public.get_unactioned_shifts()
RETURNS TABLE (
  booking_id       uuid,
  shift_id         uuid,
  volunteer_id     uuid,
  volunteer_name   text,
  volunteer_email  text,
  shift_title      text,
  shift_date       date,
  department_name  text,
  checked_in       boolean,
  actioned_off     boolean,
  shift_end        timestamptz,
  hours_since_end  numeric
) LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
BEGIN
  IF NOT public.is_coordinator_or_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    sb.id AS booking_id,
    s.id AS shift_id,
    p.id AS volunteer_id,
    p.full_name AS volunteer_name,
    p.email AS volunteer_email,
    s.title AS shift_title,
    s.shift_date,
    d.name AS department_name,
    (sb.checked_in_at IS NOT NULL) AS checked_in,
    EXISTS (
      SELECT 1 FROM public.volunteer_shift_reports vsr
      WHERE vsr.booking_id = sb.id AND vsr.submitted_at IS NOT NULL
    ) AS actioned_off,
    public.shift_end_at(s.shift_date, s.end_time, s.time_type::text) AS shift_end,
    EXTRACT(EPOCH FROM (now() - public.shift_end_at(s.shift_date, s.end_time, s.time_type::text))) / 3600.0 AS hours_since_end
  FROM public.shift_bookings sb
  JOIN public.shifts s ON s.id = sb.shift_id
  JOIN public.profiles p ON p.id = sb.volunteer_id
  LEFT JOIN public.departments d ON d.id = s.department_id
  WHERE sb.booking_status = 'confirmed'
    AND sb.confirmation_status = 'pending_confirmation'
    AND public.shift_end_at(s.shift_date, s.end_time, s.time_type::text) < now()
    AND (
      sb.checked_in_at IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.volunteer_shift_reports vsr2
        WHERE vsr2.booking_id = sb.id AND vsr2.submitted_at IS NOT NULL
      )
    )
  ORDER BY public.shift_end_at(s.shift_date, s.end_time, s.time_type::text) ASC;
END;
$$;
