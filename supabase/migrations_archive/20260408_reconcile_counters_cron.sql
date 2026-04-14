-- =============================================
-- Safety net: nightly reconcile of shifts.booked_slots and
-- shift_time_slots.booked_slots from ground truth. Catches any
-- drift that might sneak in from future trigger regressions or
-- out-of-band inserts (e.g. admin SQL maintenance).
--
-- Runs daily at 09:00 UTC (~3am Central) when nobody is booking.
-- =============================================

CREATE OR REPLACE FUNCTION public.reconcile_shift_counters()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- shifts.booked_slots: count confirmed bookings per shift
  UPDATE public.shifts s
  SET booked_slots = sub.cnt
  FROM (
    SELECT shift_id, COUNT(*) AS cnt
    FROM public.shift_bookings
    WHERE booking_status = 'confirmed'
    GROUP BY shift_id
  ) sub
  WHERE s.id = sub.shift_id
    AND s.booked_slots IS DISTINCT FROM sub.cnt;

  UPDATE public.shifts s
  SET booked_slots = 0
  WHERE s.booked_slots > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.shift_bookings sb
      WHERE sb.shift_id = s.id AND sb.booking_status = 'confirmed'
    );

  -- shift_time_slots.booked_slots: count confirmed booking-slot links
  UPDATE public.shift_time_slots sts
  SET booked_slots = LEAST(counts.cnt, sts.total_slots)
  FROM (
    SELECT sbs.slot_id, COUNT(*) AS cnt
    FROM public.shift_booking_slots sbs
    JOIN public.shift_bookings sb ON sb.id = sbs.booking_id
    WHERE sb.booking_status = 'confirmed'
    GROUP BY sbs.slot_id
  ) counts
  WHERE sts.id = counts.slot_id
    AND sts.booked_slots IS DISTINCT FROM LEAST(counts.cnt, sts.total_slots);

  UPDATE public.shift_time_slots sts
  SET booked_slots = 0
  WHERE sts.booked_slots > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.shift_booking_slots sbs
      JOIN public.shift_bookings sb ON sb.id = sbs.booking_id
      WHERE sbs.slot_id = sts.id AND sb.booking_status = 'confirmed'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_shift_counters() TO authenticated;

SELECT cron.unschedule('reconcile-shift-counters') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'reconcile-shift-counters'
);

SELECT cron.schedule(
  'reconcile-shift-counters',
  '0 9 * * *',
  $cron$SELECT public.reconcile_shift_counters();$cron$
);

-- Run once immediately to clean up any existing drift
SELECT public.reconcile_shift_counters();
