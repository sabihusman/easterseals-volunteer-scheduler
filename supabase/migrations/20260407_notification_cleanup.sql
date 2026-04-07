-- =============================================
-- Clean up orphaned notifications that reference deleted
-- bookings/shifts, and add triggers so future deletions
-- cascade cleanly.
--
-- Notifications link to bookings either via:
--   data->>'booking_id'   (newer notifications)
--   data->>'shift_id'     (shift-level)
--   link ~ '/my-shifts/confirm/<uuid>'  (self-confirmation reminders)
--   link ~ '/my-shifts/<uuid>'          (generic booking links)
-- =============================================

-- Helper: extract the UUID suffix from a /.../<uuid> path
CREATE OR REPLACE FUNCTION public.notification_link_booking_id(p_link text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_link ~ '/my-shifts/confirm/[0-9a-f-]{36}$'
      THEN substring(p_link from '([0-9a-f-]{36})$')::uuid
    WHEN p_link ~ '/my-shifts/[0-9a-f-]{36}$'
      THEN substring(p_link from '([0-9a-f-]{36})$')::uuid
    ELSE NULL
  END;
$$;

-- ══════════════════════════════════════
-- One-time cleanup of existing orphans
-- ══════════════════════════════════════

-- Delete notifications whose data.booking_id references a deleted booking
DELETE FROM public.notifications n
 WHERE n.data ? 'booking_id'
   AND (n.data->>'booking_id') ~ '^[0-9a-f-]{36}$'
   AND NOT EXISTS (
     SELECT 1 FROM public.shift_bookings sb
      WHERE sb.id = (n.data->>'booking_id')::uuid
   );

-- Delete notifications whose data.shift_id references a deleted shift
DELETE FROM public.notifications n
 WHERE n.data ? 'shift_id'
   AND (n.data->>'shift_id') ~ '^[0-9a-f-]{36}$'
   AND NOT EXISTS (
     SELECT 1 FROM public.shifts s
      WHERE s.id = (n.data->>'shift_id')::uuid
   );

-- Delete notifications whose /my-shifts/... link points at a deleted booking
DELETE FROM public.notifications n
 WHERE n.link IS NOT NULL
   AND public.notification_link_booking_id(n.link) IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.shift_bookings sb
      WHERE sb.id = public.notification_link_booking_id(n.link)
   );

-- ══════════════════════════════════════
-- Cascade cleanup on booking / shift delete
-- ══════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cleanup_notifications_for_booking()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.notifications n
   WHERE (
       -- data-based references
       (n.data ? 'booking_id' AND (n.data->>'booking_id')::uuid = OLD.id)
     OR
       -- link-based references
       (n.link IS NOT NULL AND public.notification_link_booking_id(n.link) = OLD.id)
   );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_notifications_on_booking_delete ON public.shift_bookings;
CREATE TRIGGER trg_cleanup_notifications_on_booking_delete
  AFTER DELETE ON public.shift_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_notifications_for_booking();

CREATE OR REPLACE FUNCTION public.cleanup_notifications_for_shift()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.notifications n
   WHERE (n.data ? 'shift_id' AND (n.data->>'shift_id')::uuid = OLD.id);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_notifications_on_shift_delete ON public.shifts;
CREATE TRIGGER trg_cleanup_notifications_on_shift_delete
  AFTER DELETE ON public.shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_notifications_for_shift();
