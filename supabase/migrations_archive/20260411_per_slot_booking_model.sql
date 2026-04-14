-- ============================================================
-- Per-Slot Booking Model Migration
-- ============================================================
-- Converts from shift-level booking (1 shift_bookings row per
-- shift, junction table shift_booking_slots) to per-slot booking
-- (1 shift_bookings row per 2-hour slot, direct time_slot_id FK).
-- ============================================================

-- ============================================================
-- 1A. Schema changes
-- ============================================================

-- Direct FK from booking to its time slot
ALTER TABLE public.shift_bookings
  ADD COLUMN IF NOT EXISTS time_slot_id uuid REFERENCES public.shift_time_slots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shift_bookings_time_slot_id
  ON public.shift_bookings (time_slot_id)
  WHERE time_slot_id IS NOT NULL;

-- Unique constraint on slot boundaries (needed for upsert on shift edit)
ALTER TABLE public.shift_time_slots
  DROP CONSTRAINT IF EXISTS uq_shift_slot_times;
ALTER TABLE public.shift_time_slots
  ADD CONSTRAINT uq_shift_slot_times UNIQUE (shift_id, slot_start, slot_end);

-- Prevent same volunteer from double-booking the same slot
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_per_slot
  ON public.shift_bookings (shift_id, volunteer_id, time_slot_id)
  WHERE time_slot_id IS NOT NULL
    AND booking_status IN ('confirmed', 'waitlisted');


-- ============================================================
-- 1B. Rewrite generate_shift_time_slots()
-- ============================================================
-- ALL shifts get 2-hour slots (no 4-hour minimum).
-- On UPDATE: preserve existing slots whose boundaries match,
-- delete orphans, insert new ones.

CREATE OR REPLACE FUNCTION public.generate_shift_time_slots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  slot_start time;
  slot_end   time;
BEGIN
  IF NEW.start_time IS NULL OR NEW.end_time IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.end_time <= NEW.start_time THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.start_time IS DISTINCT FROM NEW.start_time
       OR OLD.end_time IS DISTINCT FROM NEW.end_time
       OR OLD.total_slots IS DISTINCT FROM NEW.total_slots THEN

      -- Upsert matching slots, then delete orphans.
      -- First: upsert all new-boundary slots.
      slot_start := NEW.start_time;
      WHILE slot_start < NEW.end_time LOOP
        slot_end := LEAST(slot_start + interval '2 hours', NEW.end_time);
        INSERT INTO public.shift_time_slots (shift_id, slot_start, slot_end, total_slots)
        VALUES (NEW.id, slot_start, slot_end, NEW.total_slots)
        ON CONFLICT (shift_id, slot_start, slot_end)
        DO UPDATE SET total_slots = EXCLUDED.total_slots;
        slot_start := slot_end;
      END LOOP;

      -- Delete orphan slots: those outside the new time range or with
      -- boundaries that don't align to 2-hour increments from start.
      DELETE FROM public.shift_time_slots
      WHERE shift_id = NEW.id
        AND (slot_start < NEW.start_time
             OR slot_end > NEW.end_time
             OR MOD(EXTRACT(EPOCH FROM (slot_start - NEW.start_time))::int, 7200) != 0);
    END IF;
  ELSE
    -- INSERT: generate all slots fresh
    slot_start := NEW.start_time;
    WHILE slot_start < NEW.end_time LOOP
      slot_end := LEAST(slot_start + interval '2 hours', NEW.end_time);
      INSERT INTO public.shift_time_slots (shift_id, slot_start, slot_end, total_slots)
      VALUES (NEW.id, slot_start, slot_end, NEW.total_slots);
      slot_start := slot_end;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;


-- ============================================================
-- 1C. Rewrite validate_booking_slot_count()
-- ============================================================
-- Per-slot capacity check when time_slot_id is set.
-- Legacy shift-level check when time_slot_id is NULL.

CREATE OR REPLACE FUNCTION public.validate_booking_slot_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  actual_booked integer;
  max_slots integer;
BEGIN
  IF NEW.time_slot_id IS NOT NULL THEN
    -- ── Per-slot capacity check ──
    SELECT total_slots INTO max_slots
      FROM public.shift_time_slots
      WHERE id = NEW.time_slot_id
      FOR UPDATE;

    IF max_slots IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT COUNT(*) INTO actual_booked
      FROM public.shift_bookings
      WHERE time_slot_id = NEW.time_slot_id
        AND booking_status = 'confirmed'
        AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

    IF actual_booked >= max_slots THEN
      NEW.booking_status := 'waitlisted';
    END IF;
  ELSE
    -- ── Legacy shift-level capacity check ──
    SELECT total_slots INTO max_slots
      FROM public.shifts
      WHERE id = NEW.shift_id
      FOR UPDATE;

    IF max_slots IS NULL THEN
      RETURN NEW;
    END IF;

    PERFORM 1
      FROM public.shift_time_slots
      WHERE shift_id = NEW.shift_id
      FOR UPDATE;

    SELECT COUNT(*) INTO actual_booked
      FROM public.shift_bookings
      WHERE shift_id = NEW.shift_id
        AND booking_status = 'confirmed'
        AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

    IF actual_booked >= max_slots THEN
      NEW.booking_status := 'waitlisted';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;


-- ============================================================
-- 1D. Rewrite sync_booked_slots()
-- ============================================================
-- Per-slot counter update + shift-level aggregate.

CREATE OR REPLACE FUNCTION public.sync_booked_slots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_slot_id uuid;
  v_shift_id uuid;
BEGIN
  v_shift_id := COALESCE(NEW.shift_id, OLD.shift_id);
  v_slot_id  := COALESCE(NEW.time_slot_id, OLD.time_slot_id);

  -- ── Per-slot counter ──
  IF v_slot_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' AND NEW.booking_status = 'confirmed' THEN
      UPDATE public.shift_time_slots
        SET booked_slots = LEAST(booked_slots + 1, total_slots)
        WHERE id = v_slot_id;

    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.booking_status = 'confirmed' AND NEW.booking_status IN ('cancelled', 'waitlisted') THEN
        UPDATE public.shift_time_slots
          SET booked_slots = GREATEST(booked_slots - 1, 0)
          WHERE id = v_slot_id;
      ELSIF OLD.booking_status IN ('waitlisted', 'cancelled') AND NEW.booking_status = 'confirmed' THEN
        UPDATE public.shift_time_slots
          SET booked_slots = LEAST(booked_slots + 1, total_slots)
          WHERE id = v_slot_id;
      END IF;
    END IF;
  ELSE
    -- ── Legacy: shift-level only (no slot) ──
    IF TG_OP = 'INSERT' AND NEW.booking_status = 'confirmed' THEN
      UPDATE public.shifts
        SET booked_slots = booked_slots + 1
        WHERE id = v_shift_id;
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.booking_status = 'confirmed' AND NEW.booking_status IN ('cancelled', 'waitlisted') THEN
        UPDATE public.shifts
          SET booked_slots = GREATEST(booked_slots - 1, 0)
          WHERE id = v_shift_id;
      ELSIF OLD.booking_status IN ('waitlisted', 'cancelled') AND NEW.booking_status = 'confirmed' THEN
        UPDATE public.shifts
          SET booked_slots = booked_slots + 1
          WHERE id = v_shift_id;
      END IF;
    END IF;
  END IF;

  -- ── Always recompute shift-level aggregate for display ──
  UPDATE public.shifts
    SET booked_slots = (
      SELECT COUNT(*)
      FROM public.shift_bookings
      WHERE shift_id = v_shift_id
        AND booking_status = 'confirmed'
    )
    WHERE id = v_shift_id;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Re-bind the triggers (same names, new function body)
DROP TRIGGER IF EXISTS trg_sync_slots ON public.shift_bookings;
CREATE TRIGGER trg_sync_slots
  AFTER INSERT ON public.shift_bookings
  FOR EACH ROW EXECUTE FUNCTION sync_booked_slots();

DROP TRIGGER IF EXISTS trg_sync_booked_slots_update ON public.shift_bookings;
DROP TRIGGER IF EXISTS trg_sync_slots_update ON public.shift_bookings;
CREATE TRIGGER trg_sync_slots_update
  AFTER UPDATE OF booking_status ON public.shift_bookings
  FOR EACH ROW EXECUTE FUNCTION sync_booked_slots();


-- ============================================================
-- 1E. Rewrite prevent_overlapping_bookings()
-- ============================================================
-- Per-slot overlap check using slot_start/slot_end.
-- CRITICAL: strict inequalities so adjacent slots are allowed.

CREATE OR REPLACE FUNCTION public.prevent_overlapping_bookings()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  new_start time;
  new_end   time;
  new_date  date;
  overlap_count int;
BEGIN
  -- On UPDATE, only check if booking_status changed
  IF TG_OP = 'UPDATE' AND OLD.booking_status = NEW.booking_status THEN
    RETURN NEW;
  END IF;

  -- Only check confirmed/waitlisted bookings
  IF NEW.booking_status NOT IN ('confirmed', 'waitlisted') THEN
    RETURN NEW;
  END IF;

  -- Get the shift date
  SELECT s.shift_date INTO new_date
    FROM public.shifts s
    WHERE s.id = NEW.shift_id;

  IF NEW.time_slot_id IS NOT NULL THEN
    -- ── Per-slot: use slot boundaries ──
    SELECT sts.slot_start, sts.slot_end INTO new_start, new_end
      FROM public.shift_time_slots sts
      WHERE sts.id = NEW.time_slot_id;
  ELSE
    -- ── Legacy: use shift times ──
    SELECT s.start_time, s.end_time INTO new_start, new_end
      FROM public.shifts s
      WHERE s.id = NEW.shift_id;
  END IF;

  IF new_start IS NULL OR new_end IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check for overlapping confirmed bookings on same date
  -- Use strict inequalities so adjacent slots (9-11, 11-1) are OK
  SELECT COUNT(*) INTO overlap_count
  FROM public.shift_bookings sb
  JOIN public.shifts s ON s.id = sb.shift_id
  LEFT JOIN public.shift_time_slots sts ON sts.id = sb.time_slot_id
  WHERE sb.volunteer_id = NEW.volunteer_id
    AND sb.booking_status IN ('confirmed', 'waitlisted')
    AND sb.id != NEW.id
    AND s.shift_date = new_date
    AND COALESCE(sts.slot_start, s.start_time) < new_end
    AND COALESCE(sts.slot_end, s.end_time) > new_start;

  IF overlap_count > 0 THEN
    RAISE EXCEPTION 'You already have a booking that overlaps with this shift time.';
  END IF;

  RETURN NEW;
END;
$function$;


-- ============================================================
-- 1F. Rewrite promote_next_waitlist()
-- ============================================================
-- Add optional p_time_slot_id parameter for per-slot promotion.

CREATE OR REPLACE FUNCTION public.promote_next_waitlist(
  p_shift_id uuid,
  p_time_slot_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking_id uuid;
  v_volunteer_id uuid;
  v_shift_title text;
  v_shift_date date;
  v_shift_start_time time;
  v_shift_end_time time;
  v_shift_time_type text;
  v_slot_start time;
  v_slot_end time;
  v_expires_at timestamptz;
  v_shift_start timestamptz;
  v_window_minutes int;
  v_msg text;
BEGIN
  -- Get shift info
  SELECT title, shift_date, start_time, end_time, time_type::text
    INTO v_shift_title, v_shift_date, v_shift_start_time, v_shift_end_time, v_shift_time_type
    FROM public.shifts WHERE id = p_shift_id;

  IF v_shift_title IS NULL THEN RETURN NULL; END IF;

  -- Get slot info if per-slot promotion
  IF p_time_slot_id IS NOT NULL THEN
    SELECT slot_start, slot_end INTO v_slot_start, v_slot_end
      FROM public.shift_time_slots WHERE id = p_time_slot_id;

    -- Find the oldest waitlisted booking for this specific slot
    SELECT sb.id, sb.volunteer_id
      INTO v_booking_id, v_volunteer_id
      FROM public.shift_bookings sb
      WHERE sb.shift_id = p_shift_id
        AND sb.time_slot_id = p_time_slot_id
        AND sb.booking_status = 'waitlisted'
        AND (sb.waitlist_offer_expires_at IS NULL
             OR sb.waitlist_offer_expires_at < now())
      ORDER BY sb.created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED;
  ELSE
    -- Legacy shift-level promotion
    SELECT sb.id, sb.volunteer_id
      INTO v_booking_id, v_volunteer_id
      FROM public.shift_bookings sb
      WHERE sb.shift_id = p_shift_id
        AND sb.booking_status = 'waitlisted'
        AND sb.time_slot_id IS NULL
        AND (sb.waitlist_offer_expires_at IS NULL
             OR sb.waitlist_offer_expires_at < now())
      ORDER BY sb.created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED;
  END IF;

  IF v_booking_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Compute dynamic expiry
  v_shift_start := public.shift_start_at(v_shift_date, v_shift_start_time, v_shift_time_type);

  IF v_shift_start <= now() + interval '30 minutes' THEN
    -- Too close to start, skip
    RETURN NULL;
  END IF;

  v_window_minutes := EXTRACT(EPOCH FROM (v_shift_start - now()))::int / 60;

  IF v_window_minutes <= 120 THEN
    v_expires_at := v_shift_start - interval '30 minutes';
  ELSE
    v_expires_at := now() + interval '2 hours';
  END IF;

  UPDATE public.shift_bookings
  SET waitlist_offer_expires_at = v_expires_at,
      updated_at = now()
  WHERE id = v_booking_id;

  -- Build notification message
  IF p_time_slot_id IS NOT NULL AND v_slot_start IS NOT NULL THEN
    v_msg := format(
      'A spot opened for %s on %s (%s – %s). You have until %s to accept.',
      v_shift_title,
      to_char(v_shift_date, 'Mon DD'),
      to_char(v_slot_start, 'HH12:MI AM'),
      to_char(v_slot_end, 'HH12:MI AM'),
      to_char(v_expires_at AT TIME ZONE 'America/Chicago', 'HH12:MI AM')
    );
  ELSE
    v_msg := format(
      'A spot opened for %s on %s. You have until %s to accept.',
      v_shift_title,
      to_char(v_shift_date, 'Mon DD'),
      to_char(v_expires_at AT TIME ZONE 'America/Chicago', 'HH12:MI AM')
    );
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message, data, link, is_read)
  VALUES (
    v_volunteer_id,
    'waitlist_offer',
    'A spot just opened: ' || v_shift_title,
    v_msg,
    jsonb_build_object(
      'booking_id', v_booking_id,
      'shift_id', p_shift_id,
      'shift_title', v_shift_title,
      'shift_date', v_shift_date,
      'expires_at', v_expires_at,
      'time_slot_id', p_time_slot_id,
      'slot_start', v_slot_start,
      'slot_end', v_slot_end
    ),
    '/dashboard',
    false
  );

  RETURN v_booking_id;
END;
$$;


-- ============================================================
-- 1F (cont). Update waitlist promotion triggers
-- ============================================================

CREATE OR REPLACE FUNCTION public.trg_waitlist_promote_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.booking_status = 'confirmed' AND NEW.booking_status = 'cancelled' THEN
    PERFORM public.promote_next_waitlist(NEW.shift_id, NEW.time_slot_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_waitlist_promote_on_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.booking_status = 'confirmed' THEN
    PERFORM public.promote_next_waitlist(OLD.shift_id, OLD.time_slot_id);
  END IF;
  RETURN OLD;
END;
$$;


-- ============================================================
-- 1G. Update waitlist_accept() and waitlist_decline()
-- ============================================================

CREATE OR REPLACE FUNCTION public.waitlist_decline(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_volunteer_id uuid;
  v_shift_id uuid;
  v_slot_id uuid;
BEGIN
  SELECT volunteer_id, shift_id, time_slot_id
    INTO v_volunteer_id, v_shift_id, v_slot_id
    FROM public.shift_bookings
    WHERE id = p_booking_id;

  IF v_volunteer_id IS NULL THEN
    RAISE EXCEPTION 'booking not found';
  END IF;

  IF v_volunteer_id <> auth.uid() THEN
    RAISE EXCEPTION 'not your booking';
  END IF;

  DELETE FROM public.shift_bookings WHERE id = p_booking_id;

  PERFORM public.promote_next_waitlist(v_shift_id, v_slot_id);
END;
$$;

-- waitlist_accept stays the same — the rewritten validate trigger
-- handles per-slot check automatically on UPDATE to 'confirmed'.


-- ============================================================
-- 1H. Update waitlist expiry cron
-- ============================================================

SELECT cron.unschedule('waitlist-offer-expire');

SELECT cron.schedule(
  'waitlist-offer-expire',
  '*/5 * * * *',
  $cron$
  WITH expired AS (
    DELETE FROM public.shift_bookings sb
    WHERE sb.booking_status = 'waitlisted'
      AND sb.waitlist_offer_expires_at IS NOT NULL
      AND sb.waitlist_offer_expires_at < now()
    RETURNING shift_id, volunteer_id, time_slot_id
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
  SELECT public.promote_next_waitlist(shift_id, time_slot_id) FROM expired;
  $cron$
);


-- ============================================================
-- 1I. Update reconcile_shift_counters()
-- ============================================================

CREATE OR REPLACE FUNCTION public.reconcile_shift_counters()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  -- shifts.booked_slots: count ALL confirmed bookings per shift
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

  -- shift_time_slots.booked_slots: count via BOTH paths
  -- 1. New model: bookings with time_slot_id set
  -- 2. Legacy: bookings linked via shift_booking_slots junction
  UPDATE public.shift_time_slots sts
  SET booked_slots = LEAST(counts.cnt, sts.total_slots)
  FROM (
    SELECT slot_id, SUM(cnt) AS cnt FROM (
      -- New model
      SELECT time_slot_id AS slot_id, COUNT(*) AS cnt
      FROM public.shift_bookings
      WHERE time_slot_id IS NOT NULL
        AND booking_status = 'confirmed'
      GROUP BY time_slot_id
      UNION ALL
      -- Legacy junction
      SELECT sbs.slot_id, COUNT(*) AS cnt
      FROM public.shift_booking_slots sbs
      JOIN public.shift_bookings sb ON sb.id = sbs.booking_id
      WHERE sb.booking_status = 'confirmed'
        AND sb.time_slot_id IS NULL  -- only legacy bookings
      GROUP BY sbs.slot_id
    ) combined
    GROUP BY slot_id
  ) counts
  WHERE sts.id = counts.slot_id
    AND sts.booked_slots IS DISTINCT FROM LEAST(counts.cnt, sts.total_slots);

  UPDATE public.shift_time_slots sts
  SET booked_slots = 0
  WHERE sts.booked_slots > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.shift_bookings sb
      WHERE sb.time_slot_id = sts.id AND sb.booking_status = 'confirmed'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.shift_booking_slots sbs
      JOIN public.shift_bookings sb ON sb.id = sbs.booking_id
      WHERE sbs.slot_id = sts.id AND sb.booking_status = 'confirmed'
        AND sb.time_slot_id IS NULL
    );
END;
$function$;


-- ============================================================
-- 1L. Backfill
-- ============================================================

-- Step 1: Regenerate 2-hour slots for shifts that only have one
-- full-shift slot (the old <=4h behavior)
DO $$
DECLARE
  r record;
  s_start time;
  s_end   time;
  slot_s  time;
  slot_e  time;
BEGIN
  FOR r IN
    SELECT s.id, s.start_time, s.end_time, s.total_slots
    FROM public.shifts s
    WHERE s.start_time IS NOT NULL
      AND s.end_time IS NOT NULL
      AND s.end_time > s.start_time
      -- Only shifts whose ONLY slot covers the full shift
      AND (SELECT COUNT(*) FROM public.shift_time_slots sts WHERE sts.shift_id = s.id) = 1
      AND EXISTS (
        SELECT 1 FROM public.shift_time_slots sts
        WHERE sts.shift_id = s.id
          AND sts.slot_start = s.start_time
          AND sts.slot_end = s.end_time
      )
      -- And the shift duration > 2 hours (worth splitting)
      AND EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600.0 > 2
  LOOP
    s_start := r.start_time;
    s_end   := r.end_time;

    -- Check if the existing single slot has any bookings referencing it
    -- via time_slot_id (shouldn't, but be safe)
    IF NOT EXISTS (
      SELECT 1 FROM public.shift_bookings sb
      JOIN public.shift_time_slots sts ON sts.id = sb.time_slot_id
      WHERE sts.shift_id = r.id
    ) THEN
      -- Safe to delete and regenerate
      DELETE FROM public.shift_time_slots WHERE shift_id = r.id;

      slot_s := s_start;
      WHILE slot_s < s_end LOOP
        slot_e := LEAST(slot_s + interval '2 hours', s_end);
        INSERT INTO public.shift_time_slots (shift_id, slot_start, slot_end, total_slots)
        VALUES (r.id, slot_s, slot_e, r.total_slots)
        ON CONFLICT (shift_id, slot_start, slot_end) DO NOTHING;
        slot_s := slot_e;
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

-- Also generate 2-hour slots for shifts with duration <= 2h that
-- currently have a single slot (just set time_slot_id on existing
-- bookings in the next step)

-- Step 2: Backfill time_slot_id on existing bookings
-- 2a. Bookings with exactly 1 junction row
UPDATE public.shift_bookings sb
SET time_slot_id = sbs.slot_id
FROM public.shift_booking_slots sbs
WHERE sbs.booking_id = sb.id
  AND sb.time_slot_id IS NULL
  AND (SELECT COUNT(*) FROM public.shift_booking_slots x WHERE x.booking_id = sb.id) = 1;

-- 2b. Bookings with multiple junction rows: split into N rows
-- Each additional slot gets its own shift_bookings row
DO $$
DECLARE
  r record;
  extra record;
  new_id uuid;
  first_done boolean;
BEGIN
  FOR r IN
    SELECT sb.id AS booking_id, sb.shift_id, sb.volunteer_id,
           sb.booking_status, sb.confirmation_status, sb.checked_in_at,
           sb.cancelled_at, sb.waitlist_offer_expires_at,
           sb.is_group_booking, sb.group_name, sb.group_size
    FROM public.shift_bookings sb
    WHERE sb.time_slot_id IS NULL
      AND (SELECT COUNT(*) FROM public.shift_booking_slots x WHERE x.booking_id = sb.id) > 1
  LOOP
    first_done := false;
    FOR extra IN
      SELECT sbs.slot_id
      FROM public.shift_booking_slots sbs
      WHERE sbs.booking_id = r.booking_id
      ORDER BY (SELECT sts.slot_start FROM public.shift_time_slots sts WHERE sts.id = sbs.slot_id)
    LOOP
      IF NOT first_done THEN
        -- First slot: just set time_slot_id on the existing booking
        UPDATE public.shift_bookings
        SET time_slot_id = extra.slot_id
        WHERE id = r.booking_id;
        first_done := true;
      ELSE
        -- Additional slots: create new booking row
        INSERT INTO public.shift_bookings (
          shift_id, volunteer_id, booking_status, confirmation_status,
          checked_in_at, cancelled_at, waitlist_offer_expires_at,
          is_group_booking, group_name, group_size, time_slot_id
        ) VALUES (
          r.shift_id, r.volunteer_id, r.booking_status, r.confirmation_status,
          r.checked_in_at, r.cancelled_at, r.waitlist_offer_expires_at,
          r.is_group_booking, r.group_name, r.group_size, extra.slot_id
        );
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

-- Step 3: For bookings with 0 junction rows but a matching single slot
-- on their shift, set time_slot_id to that slot
UPDATE public.shift_bookings sb
SET time_slot_id = sts.id
FROM public.shift_time_slots sts
WHERE sb.time_slot_id IS NULL
  AND sts.shift_id = sb.shift_id
  AND NOT EXISTS (SELECT 1 FROM public.shift_booking_slots x WHERE x.booking_id = sb.id)
  AND (SELECT COUNT(*) FROM public.shift_time_slots x WHERE x.shift_id = sb.shift_id) = 1;
