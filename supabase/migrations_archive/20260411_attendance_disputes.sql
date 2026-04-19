-- ============================================================
-- Attendance Disputes: coordinator confirmation + dispute escalation
-- ============================================================

-- ============================================================
-- 1A. Schema changes on shift_bookings
-- ============================================================
ALTER TABLE public.shift_bookings
  ADD COLUMN IF NOT EXISTS coordinator_status text
    CHECK (coordinator_status IN ('attended', 'absent')),
  ADD COLUMN IF NOT EXISTS coordinator_actioned_at timestamptz,
  ADD COLUMN IF NOT EXISTS coordinator_actioned_by uuid REFERENCES public.profiles(id);

-- ============================================================
-- 1A. Create attendance_disputes table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.attendance_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.shift_bookings(id) ON DELETE CASCADE UNIQUE,
  shift_id uuid NOT NULL REFERENCES public.shifts(id),
  volunteer_id uuid NOT NULL REFERENCES public.profiles(id),
  coordinator_id uuid NOT NULL REFERENCES public.profiles(id),
  volunteer_status text NOT NULL,
  volunteer_reported_hours numeric,
  coordinator_status text NOT NULL,
  admin_decision text CHECK (admin_decision IN ('volunteer_upheld', 'coordinator_upheld')),
  admin_decided_by uuid REFERENCES public.profiles(id),
  admin_decided_at timestamptz,
  admin_notes text,
  resolved_by text CHECK (resolved_by IN ('admin', 'auto_timeout')),
  final_hours_awarded numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days'
);

ALTER TABLE public.attendance_disputes ENABLE ROW LEVEL SECURITY;

-- Admins: full access
CREATE POLICY "attendance_disputes: admin full access"
  ON public.attendance_disputes
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Coordinators: read their own disputes
CREATE POLICY "attendance_disputes: coordinator read own"
  ON public.attendance_disputes
  FOR SELECT
  TO authenticated
  USING (
    coordinator_id = auth.uid()
    AND public.is_coordinator_or_admin()
  );

-- Volunteers: read only resolved disputes
CREATE POLICY "attendance_disputes: volunteer read resolved"
  ON public.attendance_disputes
  FOR SELECT
  TO authenticated
  USING (
    volunteer_id = auth.uid()
    AND (admin_decision IS NOT NULL OR now() > expires_at)
  );

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_attendance_disputes_booking
  ON public.attendance_disputes (booking_id);
CREATE INDEX IF NOT EXISTS idx_attendance_disputes_pending
  ON public.attendance_disputes (admin_decision)
  WHERE admin_decision IS NULL;


-- ============================================================
-- 1B. Dispute creation trigger
-- ============================================================
-- Fires when coordinator sets coordinator_status on shift_bookings.
-- Only creates a dispute when volunteer said 'attended' AND
-- coordinator says 'absent'. All other combos resolve immediately.

CREATE OR REPLACE FUNCTION public.check_attendance_dispute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_vol_status text;
  v_vol_hours numeric;
  v_shift_duration numeric;
  v_shift_title text;
  v_shift_date date;
  v_vol_name text;
  v_coord_name text;
BEGIN
  -- Only act when coordinator_status is being set for the first time
  IF NEW.coordinator_status IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.coordinator_status IS NOT NULL THEN
    -- Already actioned — lock it
    RETURN NEW;
  END IF;

  -- Set timestamp and actor
  NEW.coordinator_actioned_at := now();
  -- coordinator_actioned_by should be set by the caller

  -- Get volunteer's self-report
  SELECT vsr.self_confirm_status, vsr.self_reported_hours
    INTO v_vol_status, v_vol_hours
    FROM public.volunteer_shift_reports vsr
    WHERE vsr.booking_id = NEW.id
      AND vsr.submitted_at IS NOT NULL
    LIMIT 1;

  -- Get shift info for notifications and hours calculation
  SELECT s.title, s.shift_date,
         GREATEST(0.5, ROUND(EXTRACT(EPOCH FROM (
           public.shift_end_at(s.shift_date, s.end_time, s.time_type::text)
           - public.shift_start_at(s.shift_date, s.start_time, s.time_type::text)
         )) / 3600.0, 2))
    INTO v_shift_title, v_shift_date, v_shift_duration
    FROM public.shifts s
    WHERE s.id = NEW.shift_id;

  -- ── Coordinator marks ATTENDED ──
  IF NEW.coordinator_status = 'attended' THEN
    -- No dispute possible. Mark as completed.
    NEW.confirmation_status := 'confirmed';
    NEW.final_hours := COALESCE(v_vol_hours, v_shift_duration);
    NEW.hours_source := COALESCE(NEW.hours_source, 'coordinator');
    RETURN NEW;
  END IF;

  -- ── Coordinator marks ABSENT ──
  IF NEW.coordinator_status = 'absent' THEN
    -- Check if volunteer claimed attendance
    IF v_vol_status = 'attended' THEN
      -- DISPUTE: volunteer says attended, coordinator says absent
      -- Don't change confirmation_status yet — leave as pending

      -- Get names for notifications
      SELECT full_name INTO v_vol_name FROM public.profiles WHERE id = NEW.volunteer_id;
      SELECT full_name INTO v_coord_name FROM public.profiles WHERE id = NEW.coordinator_actioned_by;

      INSERT INTO public.attendance_disputes (
        booking_id, shift_id, volunteer_id, coordinator_id,
        volunteer_status, volunteer_reported_hours, coordinator_status
      ) VALUES (
        NEW.id, NEW.shift_id, NEW.volunteer_id, NEW.coordinator_actioned_by,
        'attended', v_vol_hours, 'absent'
      );

      -- Notify all admins
      INSERT INTO public.notifications (user_id, type, title, message, data, link, is_read)
      SELECT
        p.id,
        'attendance_dispute',
        'Attendance dispute: ' || COALESCE(v_vol_name, 'Volunteer'),
        COALESCE(v_coord_name, 'A coordinator') || ' marked ' || COALESCE(v_vol_name, 'a volunteer') ||
          ' as absent for "' || COALESCE(v_shift_title, 'shift') || '" on ' ||
          to_char(v_shift_date, 'Mon DD') || ', but the volunteer reported attending. Admin review required.',
        jsonb_build_object(
          'booking_id', NEW.id,
          'shift_id', NEW.shift_id,
          'volunteer_id', NEW.volunteer_id,
          'volunteer_name', v_vol_name,
          'coordinator_name', v_coord_name,
          'shift_title', v_shift_title,
          'shift_date', v_shift_date
        ),
        '/admin/disputes',
        false
      FROM public.profiles p
      WHERE p.role = 'admin' AND p.is_active = true;

    ELSE
      -- No dispute: volunteer didn't claim attendance (or took no action)
      -- → Mark as no_show directly
      NEW.confirmation_status := 'no_show';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_check_attendance_dispute ON public.shift_bookings;
CREATE TRIGGER trg_check_attendance_dispute
  BEFORE UPDATE OF coordinator_status ON public.shift_bookings
  FOR EACH ROW
  EXECUTE FUNCTION check_attendance_dispute();


-- ============================================================
-- 1C. Dispute auto-resolution cron (hourly)
-- ============================================================
SELECT cron.unschedule('dispute-auto-resolve') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'dispute-auto-resolve'
);

SELECT cron.schedule(
  'dispute-auto-resolve',
  '17 * * * *',
  $cron$
  WITH resolved AS (
    UPDATE public.attendance_disputes ad
    SET admin_decision = 'volunteer_upheld',
        resolved_by = 'auto_timeout',
        final_hours_awarded = COALESCE(ad.volunteer_reported_hours, 0),
        admin_decided_at = now()
    WHERE ad.admin_decision IS NULL
      AND now() > ad.expires_at
    RETURNING ad.booking_id, ad.volunteer_id, ad.coordinator_id,
              ad.shift_id, ad.volunteer_reported_hours
  ),
  booking_updates AS (
    UPDATE public.shift_bookings sb
    SET confirmation_status = 'confirmed',
        final_hours = COALESCE(r.volunteer_reported_hours, 0),
        hours_source = 'dispute_auto_resolved',
        updated_at = now()
    FROM resolved r
    WHERE sb.id = r.booking_id
    RETURNING sb.id
  ),
  vol_notifs AS (
    INSERT INTO public.notifications (user_id, type, title, message, link, is_read)
    SELECT
      r.volunteer_id,
      'dispute_resolved',
      'Attendance confirmed',
      'Your attendance for "' || s.title || '" on ' ||
        to_char(s.shift_date, 'Mon DD') ||
        ' has been confirmed. Hours awarded: ' || COALESCE(r.volunteer_reported_hours, 0) || 'h.',
      '/history',
      false
    FROM resolved r
    JOIN public.shifts s ON s.id = r.shift_id
    RETURNING user_id
  )
  INSERT INTO public.notifications (user_id, type, title, message, link, is_read)
  SELECT
    r.coordinator_id,
    'dispute_resolved',
    'Dispute auto-resolved',
    'The attendance dispute for a volunteer on "' || s.title ||
      '" was auto-resolved in favor of the volunteer after 7 days without admin review.',
    '/coordinator',
    false
  FROM resolved r
  JOIN public.shifts s ON s.id = r.shift_id;
  $cron$
);


-- ============================================================
-- 1D. Update unactioned-shift-auto-delete behavior
-- ============================================================
-- Instead of DELETE, set confirmation_status = 'no_show' when
-- NEITHER the volunteer NOR the coordinator has taken any action
-- within 7 days after shift end. This impacts consistency score
-- via the existing trg_recalculate_consistency trigger.

SELECT cron.unschedule('unactioned-shift-auto-delete') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'unactioned-shift-auto-delete'
);

SELECT cron.schedule(
  'unactioned-shift-auto-delete',
  '0 8 * * *',
  $cron$
  UPDATE public.shift_bookings sb
  SET confirmation_status = 'no_show',
      updated_at = now()
  FROM public.shifts s
  WHERE sb.shift_id = s.id
    AND sb.booking_status = 'confirmed'
    AND sb.confirmation_status = 'pending_confirmation'
    AND sb.coordinator_status IS NULL
    AND public.shift_end_at(s.shift_date, s.end_time, s.time_type::text) < now() - interval '7 days'
    AND sb.checked_in_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.volunteer_shift_reports vsr
      WHERE vsr.booking_id = sb.id AND vsr.submitted_at IS NOT NULL
    );
  $cron$
);
