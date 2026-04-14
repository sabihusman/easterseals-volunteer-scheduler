-- =============================================
-- Auto-recalculate consistency score + extended_booking flag
-- when confirmation_status changes (so the booking window
-- extension kicks in immediately when a volunteer earns it)
-- =============================================

CREATE OR REPLACE FUNCTION trg_recalculate_consistency_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalculate_consistency(OLD.volunteer_id);
    RETURN OLD;
  ELSE
    PERFORM recalculate_consistency(NEW.volunteer_id);
    RETURN NEW;
  END IF;
END;
$$;

-- Fire on state transitions into or out of "confirmed" confirmation_status
DROP TRIGGER IF EXISTS trg_recalculate_consistency ON public.shift_bookings;
CREATE TRIGGER trg_recalculate_consistency
  AFTER UPDATE OF confirmation_status ON public.shift_bookings
  FOR EACH ROW
  WHEN (OLD.confirmation_status IS DISTINCT FROM NEW.confirmation_status)
  EXECUTE FUNCTION trg_recalculate_consistency_fn();

-- Also fire on DELETE so removing a booking updates the rolling window
DROP TRIGGER IF EXISTS trg_recalculate_consistency_delete ON public.shift_bookings;
CREATE TRIGGER trg_recalculate_consistency_delete
  AFTER DELETE ON public.shift_bookings
  FOR EACH ROW
  EXECUTE FUNCTION trg_recalculate_consistency_fn();
