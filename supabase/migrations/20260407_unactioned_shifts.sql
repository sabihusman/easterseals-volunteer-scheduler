-- =============================================
-- Unactioned shift workflow:
--   - If a volunteer doesn't check in AND/OR doesn't submit a
--     shift report after a past shift, send up to 2 reminder
--     notifications during business hours 9am-5pm Central within
--     the 48 hours after the shift.
--   - After 48h, notify the department coordinators once.
--   - After 1 week, auto-delete the booking so it stops
--     counting toward the volunteer's history / consistency.
--   - Admins and coordinators can "action off" a stale shift
--     (counts as confirmed). Admins can also delete it.
-- =============================================

-- ── Helper: compute a shift's end timestamp in America/Chicago ──
CREATE OR REPLACE FUNCTION public.shift_end_at(
  p_shift_date date,
  p_end_time   time,
  p_time_type  text
) RETURNS timestamptz
LANGUAGE sql IMMUTABLE AS $$
  SELECT (
    (p_shift_date::text || ' ' || COALESCE(
      p_end_time::text,
      CASE p_time_type
        WHEN 'morning'   THEN '12:00:00'
        WHEN 'afternoon' THEN '16:00:00'
        WHEN 'all_day'   THEN '17:00:00'
        ELSE '17:00:00'
      END
    ))::timestamp AT TIME ZONE 'America/Chicago'
  );
$$;

-- ══════════════════════════════════════
-- Volunteer reminders: runs hourly 15:00-22:00 UTC
-- (roughly 9am-5pm CST / 10am-5pm CDT). Max 2 reminders per booking
-- within the 48h window after shift end.
-- ══════════════════════════════════════
SELECT cron.unschedule('unactioned-shift-volunteer-reminder') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'unactioned-shift-volunteer-reminder'
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
    AND sb.confirmation_status = 'pending'
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
    -- Throttle: don't send two reminders within 12 hours of each other
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = sb.volunteer_id
        AND n.type = 'unactioned_shift_reminder'
        AND (n.data->>'booking_id')::uuid = sb.id
        AND n.created_at > now() - interval '12 hours'
    );
  $cron$
);

-- ══════════════════════════════════════
-- Coordinator reminder: daily at 15 UTC (~10am Central),
-- one-time per booking once the 48h window has passed.
-- ══════════════════════════════════════
SELECT cron.unschedule('unactioned-shift-coordinator-reminder') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'unactioned-shift-coordinator-reminder'
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
    AND sb.confirmation_status = 'pending'
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

-- ══════════════════════════════════════
-- Auto-delete: daily at 08 UTC (~3am Central).
-- Removes unactioned bookings older than 7 days from the shift end.
-- The existing trg_recalculate_consistency_delete trigger updates
-- the volunteer's consistency score.
-- ══════════════════════════════════════
SELECT cron.unschedule('unactioned-shift-auto-delete') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'unactioned-shift-auto-delete'
);

SELECT cron.schedule(
  'unactioned-shift-auto-delete',
  '0 8 * * *',
  $cron$
  DELETE FROM public.shift_bookings sb
  USING public.shifts s
  WHERE sb.shift_id = s.id
    AND sb.booking_status = 'confirmed'
    AND sb.confirmation_status = 'pending'
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

-- ══════════════════════════════════════
-- RPC: list unactioned shifts for admin triage, oldest first
-- ══════════════════════════════════════
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
    AND sb.confirmation_status = 'pending'
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

GRANT EXECUTE ON FUNCTION public.get_unactioned_shifts() TO authenticated;

-- ══════════════════════════════════════
-- RPC: admin/coordinator action-off
-- Action-off alone counts as confirmed; does NOT perform check-in.
-- ══════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_action_off_shift(p_booking_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_volunteer_id uuid;
  v_shift_id uuid;
  v_duration_hours numeric;
BEGIN
  IF NOT public.is_coordinator_or_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT sb.volunteer_id, sb.shift_id INTO v_volunteer_id, v_shift_id
    FROM public.shift_bookings sb WHERE sb.id = p_booking_id;

  IF v_volunteer_id IS NULL THEN
    RAISE EXCEPTION 'booking not found';
  END IF;

  -- Compute duration in hours from shift end - shift start.
  -- For morning/afternoon/all_day defaults, use sensible values.
  SELECT GREATEST(0.5, ROUND(EXTRACT(EPOCH FROM (
    public.shift_end_at(s.shift_date, s.end_time, s.time_type::text)
    - ((s.shift_date::text || ' ' || COALESCE(
          s.start_time::text,
          CASE s.time_type::text
            WHEN 'morning'   THEN '09:00:00'
            WHEN 'afternoon' THEN '13:00:00'
            WHEN 'all_day'   THEN '09:00:00'
            ELSE '09:00:00'
          END
        ))::timestamp AT TIME ZONE 'America/Chicago')
  )) / 3600.0, 2))
  INTO v_duration_hours
  FROM public.shifts s WHERE s.id = v_shift_id;

  -- Upsert the report row marked as admin-actioned
  INSERT INTO public.volunteer_shift_reports
    (booking_id, volunteer_id, self_confirm_status, self_reported_hours, submitted_at)
  VALUES
    (p_booking_id, v_volunteer_id, 'attended', v_duration_hours, now())
  ON CONFLICT (booking_id) DO UPDATE SET
    self_confirm_status = 'attended',
    self_reported_hours = COALESCE(public.volunteer_shift_reports.self_reported_hours, EXCLUDED.self_reported_hours),
    submitted_at = COALESCE(public.volunteer_shift_reports.submitted_at, now()),
    updated_at = now();

  -- Mark the booking confirmed and fill final_hours so points/consistency recalc
  UPDATE public.shift_bookings
  SET confirmation_status = 'confirmed',
      final_hours = COALESCE(final_hours, v_duration_hours),
      hours_source = COALESCE(hours_source, 'admin_action_off'),
      updated_at = now()
  WHERE id = p_booking_id;

  -- Notify the volunteer
  INSERT INTO public.notifications (user_id, type, title, message, link, is_read)
  SELECT
    v_volunteer_id,
    'booking_changed',
    'Shift marked complete',
    'Your shift "' || s.title || '" on ' || to_char(s.shift_date, 'Mon DD') ||
      ' has been marked complete by staff. Your volunteer hours have been recorded.',
    '/history',
    false
  FROM public.shifts s WHERE s.id = v_shift_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_action_off_shift(uuid) TO authenticated;

-- ══════════════════════════════════════
-- RPC: admin-only delete of an unactioned shift booking
-- ══════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_delete_unactioned_shift(p_booking_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  DELETE FROM public.shift_bookings WHERE id = p_booking_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_unactioned_shift(uuid) TO authenticated;
