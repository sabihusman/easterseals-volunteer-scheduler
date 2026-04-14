-- =============================================
-- Batch fixes from Round 3 audit of the booking trigger chain.
--
-- B4: sync_booked_slots missed the cancelled -> confirmed branch
--     (re-activated bookings after the volunteer cancelled and re-booked).
--     shifts.booked_slots fell behind by one on each re-activation.
--
-- B5: promote_next_waitlist did not check if the shift itself was
--     cancelled or had already ended. Cancelling a shift bulk-cancelled
--     its confirmed bookings, which fired trg_waitlist_promote_on_cancel,
--     which promoted waitlisted volunteers into the cancelled shift.
--     Same problem if a shift's end time passed.
--
-- B6: waitlist_accept did not check if the shift had ended before
--     converting the booking to confirmed. A volunteer who got an
--     offer just before the shift ended could accept after the shift
--     was over and still get credit.
--
-- B9: The Admin "Cancel Shift" flow updates shift_bookings.booking_status
--     from confirmed to cancelled for every row. That fires
--     trg_waitlist_promote_on_cancel individually per row — and also
--     trg_sync_slots which decrements shifts.booked_slots. Both were
--     correct in isolation but the promotion now (post B5) correctly
--     skips cancelled shifts so promotion is a no-op.
-- =============================================

-- ── sync_booked_slots: handle cancelled -> confirmed re-activation ──
CREATE OR REPLACE FUNCTION public.sync_booked_slots()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.booking_status = 'confirmed' THEN
    UPDATE public.shifts
      SET booked_slots = booked_slots + 1
      WHERE id = NEW.shift_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.booking_status = 'confirmed' AND NEW.booking_status = 'cancelled' THEN
      UPDATE public.shifts
        SET booked_slots = GREATEST(booked_slots - 1, 0)
        WHERE id = NEW.shift_id;
    ELSIF OLD.booking_status IN ('waitlisted', 'cancelled')
          AND NEW.booking_status = 'confirmed' THEN
      UPDATE public.shifts
        SET booked_slots = booked_slots + 1
        WHERE id = NEW.shift_id;
    ELSIF OLD.booking_status = 'confirmed' AND NEW.booking_status = 'waitlisted' THEN
      -- Covers the case where validate_booking_slot_count demoted us
      UPDATE public.shifts
        SET booked_slots = GREATEST(booked_slots - 1, 0)
        WHERE id = NEW.shift_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── promote_next_waitlist: skip cancelled / ended shifts ──
CREATE OR REPLACE FUNCTION public.promote_next_waitlist(p_shift_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_booking_id uuid;
  v_volunteer_id uuid;
  v_shift_title text;
  v_shift_date date;
  v_shift_status text;
  v_shift_end timestamptz;
  v_expires_at timestamptz;
BEGIN
  -- Verify the shift is still open and not ended before offering the spot.
  SELECT s.title, s.shift_date, s.status::text,
         public.shift_end_at(s.shift_date, s.end_time, s.time_type::text)
    INTO v_shift_title, v_shift_date, v_shift_status, v_shift_end
    FROM public.shifts s
    WHERE s.id = p_shift_id;

  IF v_shift_title IS NULL THEN
    RETURN NULL; -- shift gone
  END IF;
  IF v_shift_status = 'cancelled' THEN
    RETURN NULL; -- don't promote into a cancelled shift
  END IF;
  IF v_shift_end <= now() THEN
    RETURN NULL; -- don't promote into an already-ended shift
  END IF;

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

  INSERT INTO public.notifications (user_id, type, title, message, data, link, is_read)
  VALUES (
    v_volunteer_id,
    'waitlist_offer',
    'A spot just opened: ' || v_shift_title,
    'You have 2 hours to confirm or decline this shift. The offer expires at ' ||
      to_char(v_expires_at AT TIME ZONE 'America/Chicago', 'HH12:MI AM Mon DD'),
    jsonb_build_object(
      'booking_id', v_booking_id,
      'shift_id',   p_shift_id,
      'shift_title', v_shift_title,
      'shift_date',  v_shift_date,
      'expires_at',  v_expires_at
    ),
    '/dashboard',
    false
  );

  RETURN v_booking_id;
END;
$function$;

-- ── waitlist_accept: also reject if shift has ended ──
CREATE OR REPLACE FUNCTION public.waitlist_accept(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_volunteer_id uuid;
  v_shift_id uuid;
  v_offer_expires timestamptz;
  v_status booking_status;
  v_shift_end timestamptz;
  v_shift_status text;
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

  -- Verify shift is still valid before accepting
  SELECT s.status::text,
         public.shift_end_at(s.shift_date, s.end_time, s.time_type::text)
    INTO v_shift_status, v_shift_end
    FROM public.shifts s WHERE s.id = v_shift_id;

  IF v_shift_status = 'cancelled' THEN
    RAISE EXCEPTION 'shift was cancelled';
  END IF;
  IF v_shift_end <= now() THEN
    RAISE EXCEPTION 'shift has already ended';
  END IF;

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
$function$;

NOTIFY pgrst, 'reload schema';
