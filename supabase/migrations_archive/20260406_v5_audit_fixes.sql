-- =============================================
-- V5 AUDIT FIXES
-- =============================================

-- ── Calendar feed: long-lived token instead of JWT ──
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS calendar_token uuid DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_calendar_token ON public.profiles(calendar_token);

-- ── BG cascade: skip same-day shifts (only cancel future, not today) ──
CREATE OR REPLACE FUNCTION cascade_bg_check_expiry()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.bg_check_status IN ('expired', 'failed'))
     AND (OLD.bg_check_status IS DISTINCT FROM NEW.bg_check_status) THEN

    -- Cancel future bookings only (strictly after today, not same-day)
    UPDATE public.shift_bookings sb
    SET booking_status = 'cancelled', cancelled_at = now(), updated_at = now()
    FROM public.shifts s
    WHERE sb.shift_id = s.id
      AND sb.volunteer_id = NEW.id
      AND sb.booking_status = 'confirmed'
      AND s.shift_date > CURRENT_DATE
      AND (s.requires_bg_check = true
           OR EXISTS (SELECT 1 FROM public.departments d WHERE d.id = s.department_id AND d.requires_bg_check = true));

    -- Warn coordinator about same-day affected shifts (don't cancel them)
    INSERT INTO public.notifications (user_id, title, message, type, link, is_read)
    SELECT
      dc.coordinator_id,
      'BG Check Alert: ' || NEW.full_name,
      NEW.full_name || '''s background check has ' || NEW.bg_check_status || '. They have a shift TODAY that requires a BG check.',
      'bg_check_status_change',
      '/coordinator',
      false
    FROM public.shift_bookings sb
    JOIN public.shifts s ON sb.shift_id = s.id
    JOIN public.department_coordinators dc ON dc.department_id = s.department_id
    WHERE sb.volunteer_id = NEW.id
      AND sb.booking_status = 'confirmed'
      AND s.shift_date = CURRENT_DATE
      AND (s.requires_bg_check = true
           OR EXISTS (SELECT 1 FROM public.departments d WHERE d.id = s.department_id AND d.requires_bg_check = true));

    -- Notify the volunteer
    INSERT INTO public.notifications (user_id, title, message, type, link, is_read)
    VALUES (
      NEW.id,
      'Background Check Status Changed',
      'Your background check status has changed to ' || NEW.bg_check_status || '. Future shifts requiring a BG check have been cancelled.',
      'bg_check_status_change',
      '/dashboard',
      false
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Points trigger: only fire on state delta (prevent double-count) ──
DROP TRIGGER IF EXISTS trg_recalculate_points ON public.shift_bookings;
CREATE TRIGGER trg_recalculate_points
  AFTER UPDATE OF confirmation_status ON public.shift_bookings
  FOR EACH ROW
  WHEN (OLD.confirmation_status IS DISTINCT FROM 'confirmed' AND NEW.confirmation_status = 'confirmed')
  EXECUTE FUNCTION trg_recalculate_points_fn();
