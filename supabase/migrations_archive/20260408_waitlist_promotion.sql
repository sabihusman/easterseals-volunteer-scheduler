-- =============================================
-- Waitlist promotion workflow:
--
-- When a confirmed volunteer cancels, promote the next waitlisted
-- volunteer. Promotion is an OFFER: their booking gets
-- waitlist_offer_expires_at = now() + 2 hours. They must accept
-- within that window or the offer forfeits and we try the next in line.
-- =============================================

-- Columns that carry offer state on waitlisted bookings
ALTER TABLE public.shift_bookings
  ADD COLUMN IF NOT EXISTS waitlist_offer_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS shift_bookings_waitlist_offer_idx
  ON public.shift_bookings (waitlist_offer_expires_at)
  WHERE waitlist_offer_expires_at IS NOT NULL;

-- ══════════════════════════════════════
-- promote_next_waitlist(shift_id): finds the oldest waitlisted
-- booking that doesn't already have an active offer, stamps it with
-- a 2-hour offer window, and inserts an in-app notification. Returns
-- the promoted booking id (or null if nobody was waitlisted).
--
-- Email/SMS go out via the notification-webhook edge function.
-- ══════════════════════════════════════
CREATE OR REPLACE FUNCTION public.promote_next_waitlist(p_shift_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking_id uuid;
  v_volunteer_id uuid;
  v_shift_title text;
  v_shift_date date;
  v_expires_at timestamptz;
BEGIN
  -- Find the oldest waitlisted booking that isn't already sitting on an
  -- active offer. Lock the row so concurrent promotions don't double-offer.
  SELECT sb.id, sb.volunteer_id
    INTO v_booking_id, v_volunteer_id
    FROM public.shift_bookings sb
    WHERE sb.shift_id = p_shift_id
      AND sb.booking_status = 'waitlisted'
      AND (sb.waitlist_offer_expires_at IS NULL
           OR sb.waitlist_offer_expires_at < now())
    ORDER BY sb.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

  IF v_booking_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_expires_at := now() + interval '2 hours';

  UPDATE public.shift_bookings
  SET waitlist_offer_expires_at = v_expires_at,
      updated_at = now()
  WHERE id = v_booking_id;

  SELECT title, shift_date INTO v_shift_title, v_shift_date
    FROM public.shifts WHERE id = p_shift_id;

  INSERT INTO public.notifications (user_id, type, title, message, data, link, is_read)
  VALUES (
    v_volunteer_id,
    'waitlist_offer',
    'A spot just opened: ' || v_shift_title,
    'You have 2 hours to confirm or decline this shift. The offer expires at ' ||
      to_char(v_expires_at AT TIME ZONE 'America/Chicago', 'HH12:MI AM'),
    jsonb_build_object(
      'booking_id', v_booking_id,
      'shift_id', p_shift_id,
      'shift_title', v_shift_title,
      'shift_date', v_shift_date,
      'expires_at', v_expires_at
    ),
    '/dashboard',
    false
  );

  RETURN v_booking_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.promote_next_waitlist(uuid) TO authenticated;

-- ══════════════════════════════════════
-- Trigger: when a confirmed booking transitions to cancelled, promote
-- the next waitlisted volunteer for the same shift.
-- ══════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trg_waitlist_promote_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.booking_status = 'confirmed' AND NEW.booking_status = 'cancelled' THEN
    PERFORM public.promote_next_waitlist(NEW.shift_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_waitlist_promote ON public.shift_bookings;
CREATE TRIGGER trg_waitlist_promote
  AFTER UPDATE OF booking_status ON public.shift_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_waitlist_promote_on_cancel();

-- Also promote when a confirmed booking is deleted (admin hard delete, etc.)
CREATE OR REPLACE FUNCTION public.trg_waitlist_promote_on_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.booking_status = 'confirmed' THEN
    PERFORM public.promote_next_waitlist(OLD.shift_id);
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_waitlist_promote_delete ON public.shift_bookings;
CREATE TRIGGER trg_waitlist_promote_delete
  AFTER DELETE ON public.shift_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_waitlist_promote_on_delete();

-- ══════════════════════════════════════
-- RPC: waitlist_accept — volunteer accepts the offered spot
-- ══════════════════════════════════════
CREATE OR REPLACE FUNCTION public.waitlist_accept(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_volunteer_id uuid;
  v_shift_id uuid;
  v_offer_expires timestamptz;
  v_status booking_status;
BEGIN
  SELECT volunteer_id, shift_id, waitlist_offer_expires_at, booking_status
    INTO v_volunteer_id, v_shift_id, v_offer_expires, v_status
    FROM public.shift_bookings
    WHERE id = p_booking_id
    FOR UPDATE;

  IF v_volunteer_id IS NULL THEN
    RAISE EXCEPTION 'booking not found';
  END IF;

  IF v_volunteer_id <> auth.uid() THEN
    RAISE EXCEPTION 'not your booking';
  END IF;

  IF v_status <> 'waitlisted' THEN
    RAISE EXCEPTION 'no active waitlist offer';
  END IF;

  IF v_offer_expires IS NULL OR v_offer_expires < now() THEN
    RAISE EXCEPTION 'offer has expired';
  END IF;

  -- Promote to confirmed. sync_booked_slots will bump the shift count.
  -- validate_booking_slot_count will lock the shift row and verify
  -- capacity; if the shift somehow filled, this will re-demote to
  -- waitlisted — but that's fine because the trigger also clears the
  -- offer expiry so the volunteer stays on the list.
  UPDATE public.shift_bookings
  SET booking_status = 'confirmed',
      waitlist_offer_expires_at = NULL,
      updated_at = now()
  WHERE id = p_booking_id;

  INSERT INTO public.notifications (user_id, type, title, message, link, is_read)
  VALUES (
    v_volunteer_id,
    'booking_confirmed',
    'Shift confirmed',
    'You are now confirmed for the shift.',
    '/dashboard',
    false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.waitlist_accept(uuid) TO authenticated;

-- ══════════════════════════════════════
-- RPC: waitlist_decline — volunteer passes, promote the next in line
-- ══════════════════════════════════════
CREATE OR REPLACE FUNCTION public.waitlist_decline(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_volunteer_id uuid;
  v_shift_id uuid;
BEGIN
  SELECT volunteer_id, shift_id INTO v_volunteer_id, v_shift_id
    FROM public.shift_bookings
    WHERE id = p_booking_id;

  IF v_volunteer_id IS NULL THEN
    RAISE EXCEPTION 'booking not found';
  END IF;

  IF v_volunteer_id <> auth.uid() THEN
    RAISE EXCEPTION 'not your booking';
  END IF;

  -- Remove this volunteer from the waitlist entirely. The DELETE
  -- trigger for waitlisted bookings would not fire promote_next
  -- (only confirmed bookings do), so we call it explicitly below.
  DELETE FROM public.shift_bookings WHERE id = p_booking_id;

  PERFORM public.promote_next_waitlist(v_shift_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.waitlist_decline(uuid) TO authenticated;

-- ══════════════════════════════════════
-- Cron: every 5 minutes, forfeit any expired waitlist offers and
-- promote the next volunteer. Removes the offered booking (the
-- volunteer did not respond in time) and re-runs promotion.
-- ══════════════════════════════════════
SELECT cron.unschedule('waitlist-offer-expire')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'waitlist-offer-expire');

SELECT cron.schedule(
  'waitlist-offer-expire',
  '*/5 * * * *',
  $cron$
  WITH expired AS (
    DELETE FROM public.shift_bookings sb
    WHERE sb.booking_status = 'waitlisted'
      AND sb.waitlist_offer_expires_at IS NOT NULL
      AND sb.waitlist_offer_expires_at < now()
    RETURNING shift_id, volunteer_id
  ),
  notifs AS (
    INSERT INTO public.notifications (user_id, type, title, message, link, is_read)
    SELECT
      e.volunteer_id,
      'waitlist_offer_expired',
      'Waitlist offer expired',
      'You did not respond to the waitlist offer in time. Your spot has been forfeited.',
      '/dashboard',
      false
    FROM expired e
    RETURNING user_id
  )
  SELECT public.promote_next_waitlist(shift_id) FROM expired;
  $cron$
);
