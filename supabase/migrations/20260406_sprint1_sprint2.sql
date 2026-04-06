-- =============================================
-- SPRINT 1 + 2 MIGRATIONS
-- =============================================

-- ── 1.3: Admin action log table ──
CREATE TABLE IF NOT EXISTS public.admin_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES public.profiles(id),
  volunteer_id uuid NOT NULL REFERENCES public.profiles(id),
  action text NOT NULL,
  payload jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.admin_action_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read all logs"
  ON public.admin_action_log FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Service role can insert logs"
  ON public.admin_action_log FOR INSERT
  WITH CHECK (true);

-- ── 1.4: Add data column to notifications for rich reminder content ──
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS data jsonb;

-- ── 2.1: Avatar URL on profiles ──
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;

-- ── 2.2: Points system ──
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS volunteer_points integer DEFAULT 0;

CREATE OR REPLACE FUNCTION recalculate_points(volunteer_uuid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pts integer := 0;
  shift_pts integer := 0;
  rating_pts integer := 0;
  milestone_pts integer := 0;
BEGIN
  -- 10 points per confirmed completed shift
  SELECT COALESCE(COUNT(*) * 10, 0) INTO shift_pts
  FROM shift_bookings
  WHERE volunteer_id = volunteer_uuid
    AND booking_status = 'confirmed'
    AND confirmation_status = 'confirmed';

  -- 5 points for every 5-star shift rating
  SELECT COALESCE(COUNT(*) * 5, 0) INTO rating_pts
  FROM volunteer_shift_reports vsr
  JOIN shift_bookings sb ON vsr.booking_id = sb.id
  WHERE sb.volunteer_id = volunteer_uuid
    AND vsr.star_rating = 5;

  -- 25 points for each completed 10-hour milestone
  SELECT COALESCE(floor(total_hours / 10) * 25, 0) INTO milestone_pts
  FROM profiles WHERE id = volunteer_uuid;

  pts := shift_pts + rating_pts + milestone_pts;
  UPDATE profiles SET volunteer_points = pts WHERE id = volunteer_uuid;
END;
$$;

CREATE OR REPLACE FUNCTION trg_recalculate_points_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM recalculate_points(NEW.volunteer_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalculate_points ON public.shift_bookings;
CREATE TRIGGER trg_recalculate_points
  AFTER UPDATE OF confirmation_status ON public.shift_bookings
  FOR EACH ROW
  WHEN (NEW.confirmation_status = 'confirmed')
  EXECUTE FUNCTION trg_recalculate_points_fn();

-- ── 3.3: Per-notification-type opt-out columns ──
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notif_shift_reminders boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS notif_new_messages boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS notif_milestone boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS notif_document_expiry boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS notif_booking_changes boolean DEFAULT true;

-- ── 1.4: Automated shift reminders (pg_cron) ──
-- 24-hour reminder: runs every hour, catches shifts tomorrow
SELECT cron.schedule(
  'shift-reminder-24h',
  '0 * * * *',
  $$
  INSERT INTO notifications (user_id, type, title, message, data)
  SELECT
    sb.volunteer_id,
    'shift_reminder_auto',
    'Reminder: ' || s.title || ' is tomorrow',
    'Your shift starts at ' || to_char(s.shift_date, 'Mon DD') || ' at ' ||
      to_char((s.start_time)::time, 'HH12:MI AM') || ' at ' || coalesce(l.name, 'the scheduled location') || '.',
    jsonb_build_object(
      'shift_id', s.id, 'shift_title', s.title, 'shift_date', s.shift_date,
      'start_time', s.start_time, 'location_name', l.name,
      'location_address', l.address, 'coordinator_note', s.coordinator_note
    )
  FROM shift_bookings sb
  JOIN shifts s ON sb.shift_id = s.id
  LEFT JOIN departments d ON s.department_id = d.id
  LEFT JOIN locations l ON d.location_id = l.id
  WHERE sb.booking_status = 'confirmed'
    AND s.shift_date = current_date + interval '1 day'
    AND NOT EXISTS (
      SELECT 1 FROM notifications n
      WHERE n.user_id = sb.volunteer_id
        AND n.type = 'shift_reminder_auto'
        AND (n.data->>'shift_id')::uuid = s.id
        AND n.created_at > now() - interval '20 hours'
    );
  $$
);

-- 2-hour reminder: runs at :30 past each hour
SELECT cron.schedule(
  'shift-reminder-2h',
  '30 * * * *',
  $$
  INSERT INTO notifications (user_id, type, title, message, data)
  SELECT
    sb.volunteer_id,
    'shift_reminder_auto',
    s.title || ' starts in 2 hours',
    'Head out soon — your shift starts at ' ||
      to_char((s.start_time)::time, 'HH12:MI AM') || ' at ' || coalesce(l.name, 'the scheduled location') || '.',
    jsonb_build_object(
      'shift_id', s.id, 'shift_title', s.title, 'shift_date', s.shift_date,
      'start_time', s.start_time, 'location_name', l.name,
      'location_address', l.address, 'coordinator_note', s.coordinator_note
    )
  FROM shift_bookings sb
  JOIN shifts s ON sb.shift_id = s.id
  LEFT JOIN departments d ON s.department_id = d.id
  LEFT JOIN locations l ON d.location_id = l.id
  WHERE sb.booking_status = 'confirmed'
    AND s.shift_date = current_date
    AND extract(hour from (s.start_time::time)) BETWEEN
        extract(hour from now() at time zone 'America/Chicago') + 1
        AND extract(hour from now() at time zone 'America/Chicago') + 3
    AND NOT EXISTS (
      SELECT 1 FROM notifications n
      WHERE n.user_id = sb.volunteer_id
        AND n.type = 'shift_reminder_auto'
        AND (n.data->>'shift_id')::uuid = s.id
        AND n.created_at > now() - interval '1 hour'
    );
  $$
);
