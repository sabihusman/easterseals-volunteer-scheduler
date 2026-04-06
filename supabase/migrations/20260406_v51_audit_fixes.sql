-- =============================================
-- V5.1 AUDIT FIXES
-- =============================================

-- ══════════════════════════════════════
-- FIX #1 + #5: Points — hours-based, handles regression + deletion
-- Replace flat +10 with final_hours * 10
-- Fire on confirmation AND un-confirmation AND delete
-- ══════════════════════════════════════

CREATE OR REPLACE FUNCTION recalculate_points(volunteer_uuid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pts integer := 0;
  shift_pts integer := 0;
  rating_pts integer := 0;
  milestone_pts integer := 0;
BEGIN
  -- Points per hour of confirmed completed shifts (not flat per shift)
  SELECT COALESCE(SUM(COALESCE(final_hours, 0)) * 10, 0)::integer INTO shift_pts
  FROM shift_bookings
  WHERE volunteer_id = volunteer_uuid
    AND booking_status = 'confirmed'
    AND confirmation_status = 'confirmed';

  -- 5 points for every 5-star shift rating
  SELECT COALESCE(COUNT(*) * 5, 0)::integer INTO rating_pts
  FROM volunteer_shift_reports vsr
  JOIN shift_bookings sb ON vsr.booking_id = sb.id
  WHERE sb.volunteer_id = volunteer_uuid
    AND vsr.star_rating = 5;

  -- 25 points for each completed 10-hour milestone
  SELECT COALESCE(floor(total_hours / 10) * 25, 0)::integer INTO milestone_pts
  FROM profiles WHERE id = volunteer_uuid;

  pts := shift_pts + rating_pts + milestone_pts;
  UPDATE profiles SET volunteer_points = pts WHERE id = volunteer_uuid;
END;
$$;

-- Trigger function that handles both INSERT/UPDATE/DELETE
CREATE OR REPLACE FUNCTION trg_recalculate_points_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalculate_points(OLD.volunteer_id);
    RETURN OLD;
  ELSE
    PERFORM recalculate_points(NEW.volunteer_id);
    RETURN NEW;
  END IF;
END;
$$;

-- Drop old trigger and create comprehensive ones
DROP TRIGGER IF EXISTS trg_recalculate_points ON public.shift_bookings;

-- Fire on confirmation status changes (both directions)
CREATE TRIGGER trg_recalculate_points_update
  AFTER UPDATE OF confirmation_status ON public.shift_bookings
  FOR EACH ROW
  WHEN (OLD.confirmation_status IS DISTINCT FROM NEW.confirmation_status)
  EXECUTE FUNCTION trg_recalculate_points_fn();

-- Fire on booking status changes (confirmed → cancelled etc.)
CREATE TRIGGER trg_recalculate_points_booking_status
  AFTER UPDATE OF booking_status ON public.shift_bookings
  FOR EACH ROW
  WHEN (OLD.booking_status IS DISTINCT FROM NEW.booking_status)
  EXECUTE FUNCTION trg_recalculate_points_fn();

-- Fire on row deletion
CREATE TRIGGER trg_recalculate_points_delete
  AFTER DELETE ON public.shift_bookings
  FOR EACH ROW
  EXECUTE FUNCTION trg_recalculate_points_fn();

-- ══════════════════════════════════════
-- FIX #4: Waitlist ghosting on BG expiry
-- Also cancel/remove waitlisted bookings on BG-required shifts
-- ══════════════════════════════════════

CREATE OR REPLACE FUNCTION cascade_bg_check_expiry()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.bg_check_status IN ('expired', 'failed'))
     AND (OLD.bg_check_status IS DISTINCT FROM NEW.bg_check_status) THEN

    -- Cancel future CONFIRMED bookings (strictly after today)
    UPDATE public.shift_bookings sb
    SET booking_status = 'cancelled', cancelled_at = now(), updated_at = now()
    FROM public.shifts s
    WHERE sb.shift_id = s.id
      AND sb.volunteer_id = NEW.id
      AND sb.booking_status = 'confirmed'
      AND s.shift_date > CURRENT_DATE
      AND (s.requires_bg_check = true
           OR EXISTS (SELECT 1 FROM public.departments d WHERE d.id = s.department_id AND d.requires_bg_check = true));

    -- Also cancel WAITLISTED bookings on BG-required shifts
    UPDATE public.shift_bookings sb
    SET booking_status = 'cancelled', cancelled_at = now(), updated_at = now()
    FROM public.shifts s
    WHERE sb.shift_id = s.id
      AND sb.volunteer_id = NEW.id
      AND sb.booking_status = 'waitlisted'
      AND s.shift_date >= CURRENT_DATE
      AND (s.requires_bg_check = true
           OR EXISTS (SELECT 1 FROM public.departments d WHERE d.id = s.department_id AND d.requires_bg_check = true));

    -- Warn coordinator about same-day affected shifts
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
      'Your background check status has changed to ' || NEW.bg_check_status || '. Future shifts and waitlist entries requiring a BG check have been cancelled.',
      'bg_check_status_change',
      '/dashboard',
      false
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
