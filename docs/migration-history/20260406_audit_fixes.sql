-- =============================================
-- AUDIT FIXES — 2026-04-06
-- Addresses spec review findings
-- =============================================

-- ══════════════════════════════════════
-- FIX: Overbooking bypass on UPDATE (waitlisted -> confirmed)
-- The original trigger only fired on INSERT. This adds UPDATE coverage.
-- ══════════════════════════════════════

DROP TRIGGER IF EXISTS trg_validate_booking_slots ON public.shift_bookings;
DROP TRIGGER IF EXISTS trg_validate_booking_slots_update ON public.shift_bookings;

-- INSERT trigger (existing, recreated)
CREATE TRIGGER trg_validate_booking_slots
  BEFORE INSERT ON public.shift_bookings
  FOR EACH ROW
  WHEN (NEW.booking_status = 'confirmed')
  EXECUTE FUNCTION validate_booking_slot_count();

-- UPDATE trigger (new — catches waitlisted -> confirmed)
CREATE TRIGGER trg_validate_booking_slots_update
  BEFORE UPDATE ON public.shift_bookings
  FOR EACH ROW
  WHEN (OLD.booking_status IS DISTINCT FROM 'confirmed' AND NEW.booking_status = 'confirmed')
  EXECUTE FUNCTION validate_booking_slot_count();

-- ══════════════════════════════════════
-- FIX: BG check expiry cascade to future bookings
-- When a volunteer's BG check expires or fails, cancel their
-- future confirmed bookings on shifts that require BG checks.
-- ══════════════════════════════════════

CREATE OR REPLACE FUNCTION cascade_bg_check_expiry()
RETURNS TRIGGER AS $$
BEGIN
  -- Only act when bg_check_status changes TO expired or failed
  IF (NEW.bg_check_status IN ('expired', 'failed'))
     AND (OLD.bg_check_status IS DISTINCT FROM NEW.bg_check_status) THEN

    -- Cancel future confirmed bookings on BG-required shifts
    UPDATE public.shift_bookings sb
    SET booking_status = 'cancelled',
        cancelled_at = now(),
        updated_at = now()
    FROM public.shifts s
    WHERE sb.shift_id = s.id
      AND sb.volunteer_id = NEW.id
      AND sb.booking_status = 'confirmed'
      AND s.shift_date >= CURRENT_DATE
      AND (s.requires_bg_check = true
           OR EXISTS (
             SELECT 1 FROM public.departments d
             WHERE d.id = s.department_id AND d.requires_bg_check = true
           ));

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

DROP TRIGGER IF EXISTS trg_cascade_bg_check_expiry ON public.profiles;
CREATE TRIGGER trg_cascade_bg_check_expiry
  AFTER UPDATE OF bg_check_status ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION cascade_bg_check_expiry();

-- ══════════════════════════════════════
-- FIX: Reschedule pg_cron jobs to Iowa-appropriate UTC times
-- Iowa is UTC-5 (CDT) / UTC-6 (CST)
-- Target: expire at ~2 AM CDT = 7 AM UTC
-- Target: warn at ~8 AM CDT = 1 PM UTC
-- ══════════════════════════════════════

SELECT cron.unschedule('expire-documents-daily');
SELECT cron.unschedule('warn-expiring-documents-daily');

SELECT cron.schedule('expire-documents-daily', '0 7 * * *', $$SELECT expire_documents()$$);
SELECT cron.schedule('warn-expiring-documents-daily', '0 13 * * *', $$SELECT warn_expiring_documents()$$);
