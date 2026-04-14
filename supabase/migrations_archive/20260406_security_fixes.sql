-- =============================================
-- SECURITY FIXES & BUG PATCHES
-- Based on architecture review 2026-04-06
-- =============================================

-- ══════════════════════════════════════
-- SECURITY FIX A: Verify storage bucket policies
-- (Already correct in 20260406_document_storage.sql:
--  volunteers scoped to auth.uid() folder,
--  coordinators/admins via is_coordinator_or_admin())
-- No changes needed — policies are correctly configured.
-- ══════════════════════════════════════

-- ══════════════════════════════════════
-- SECURITY FIX B: Messaging — prevent removed participants
-- from reading new messages. Add DELETE policy so users
-- can be hard-removed, and ensure archived users can't read.
-- ══════════════════════════════════════

-- Allow conversation creator or admin to remove participants
CREATE POLICY "Creator or admin removes participants"
  ON public.conversation_participants FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations
      WHERE id = conversation_id AND created_by = auth.uid()
    )
    OR public.is_admin()
  );

-- Update messages RLS to exclude archived participants
DROP POLICY IF EXISTS "Participants read messages" ON public.messages;
CREATE POLICY "Active participants read messages"
  ON public.messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = messages.conversation_id
        AND user_id = auth.uid()
        AND is_archived = false
    )
    OR public.is_admin()
  );

-- Update messages INSERT to also check not archived
DROP POLICY IF EXISTS "Participants send messages" ON public.messages;
CREATE POLICY "Active participants send messages"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = messages.conversation_id
        AND user_id = auth.uid()
        AND is_archived = false
    )
  );

-- ══════════════════════════════════════
-- SECURITY FIX C: Enforce max 2 participants on bulk conversations
-- Trigger prevents adding a 3rd participant to bulk conversations
-- ══════════════════════════════════════

CREATE OR REPLACE FUNCTION enforce_bulk_conversation_limit()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.conversations
    WHERE id = NEW.conversation_id
      AND conversation_type = 'bulk'
  ) THEN
    IF (
      SELECT COUNT(*) FROM public.conversation_participants
      WHERE conversation_id = NEW.conversation_id
    ) >= 2 THEN
      RAISE EXCEPTION 'Bulk conversations cannot have more than 2 participants';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_bulk_limit
  BEFORE INSERT ON public.conversation_participants
  FOR EACH ROW
  EXECUTE FUNCTION enforce_bulk_conversation_limit();

-- ══════════════════════════════════════
-- SECURITY FIX D: Verify private notes are volunteer-only
-- Drop any overly permissive policies and recreate strict ones
-- ══════════════════════════════════════

-- First check what policies exist (safe to re-run)
DROP POLICY IF EXISTS "Volunteers read own notes" ON public.volunteer_private_notes;
DROP POLICY IF EXISTS "Volunteers insert own notes" ON public.volunteer_private_notes;
DROP POLICY IF EXISTS "Volunteers update own notes" ON public.volunteer_private_notes;
DROP POLICY IF EXISTS "Volunteers delete own notes" ON public.volunteer_private_notes;
DROP POLICY IF EXISTS "Users manage own private notes" ON public.volunteer_private_notes;
DROP POLICY IF EXISTS "admin_read_private_notes" ON public.volunteer_private_notes;

-- Recreate strict volunteer-only policies (NO admin override)
CREATE POLICY "Volunteers read own notes"
  ON public.volunteer_private_notes FOR SELECT
  TO authenticated
  USING (volunteer_id = auth.uid());

CREATE POLICY "Volunteers insert own notes"
  ON public.volunteer_private_notes FOR INSERT
  TO authenticated
  WITH CHECK (volunteer_id = auth.uid());

CREATE POLICY "Volunteers update own notes"
  ON public.volunteer_private_notes FOR UPDATE
  TO authenticated
  USING (volunteer_id = auth.uid())
  WITH CHECK (volunteer_id = auth.uid());

CREATE POLICY "Volunteers delete own notes"
  ON public.volunteer_private_notes FOR DELETE
  TO authenticated
  USING (volunteer_id = auth.uid());

-- ══════════════════════════════════════
-- BUG FIX A: Automated document expiry
-- Creates a function that marks approved documents as expired
-- when expires_at < now(). Must be called via pg_cron or
-- scheduled edge function.
-- ══════════════════════════════════════

CREATE OR REPLACE FUNCTION expire_documents()
RETURNS integer AS $$
DECLARE
  expired_count integer;
BEGIN
  UPDATE public.volunteer_documents
  SET status = 'expired', updated_at = now()
  WHERE status = 'approved'
    AND expires_at IS NOT NULL
    AND expires_at < now();

  GET DIAGNOSTICS expired_count = ROW_COUNT;

  -- Insert notifications for newly expired documents
  INSERT INTO public.notifications (user_id, title, message, type, link, is_read)
  SELECT
    vd.volunteer_id,
    'Document Expired: ' || dt.name,
    'Your ' || dt.name || ' has expired. Please upload a new version.',
    'document_expired',
    '/documents',
    false
  FROM public.volunteer_documents vd
  JOIN public.document_types dt ON dt.id = vd.document_type_id
  WHERE vd.status = 'expired'
    AND vd.updated_at >= now() - interval '1 minute';

  RETURN expired_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule via pg_cron (runs daily at 2 AM)
-- Note: pg_cron must be enabled first.
-- Enable it in Supabase Dashboard > Database > Extensions > search "pg_cron" > Enable
-- Then run these two schedule commands separately:
--
-- SELECT cron.schedule('expire-documents-daily', '0 2 * * *', $$SELECT expire_documents()$$);
-- SELECT cron.schedule('warn-expiring-documents-daily', '0 8 * * *', $$SELECT warn_expiring_documents()$$);
--

-- Also create a 30-day warning function
CREATE OR REPLACE FUNCTION warn_expiring_documents()
RETURNS integer AS $$
DECLARE
  warned_count integer;
BEGIN
  -- Notify for documents expiring within 30 days that haven't been warned yet
  INSERT INTO public.notifications (user_id, title, message, type, link, is_read)
  SELECT
    vd.volunteer_id,
    'Document Expiring Soon: ' || dt.name,
    'Your ' || dt.name || ' expires on ' || to_char(vd.expires_at, 'Mon DD, YYYY') || '. Please upload a renewed version.',
    'document_expiry_warning',
    '/documents',
    false
  FROM public.volunteer_documents vd
  JOIN public.document_types dt ON dt.id = vd.document_type_id
  WHERE vd.status = 'approved'
    AND vd.expires_at IS NOT NULL
    AND vd.expires_at BETWEEN now() AND now() + interval '30 days'
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = vd.volunteer_id
        AND n.type = 'document_expiry_warning'
        AND n.message LIKE '%' || dt.name || '%'
        AND n.created_at > now() - interval '7 days'
    );

  GET DIAGNOSTICS warned_count = ROW_COUNT;
  RETURN warned_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- (pg_cron schedule command is commented above with expire_documents)

-- ══════════════════════════════════════
-- BUG FIX B: Fix recommendation novelty score
-- Cap the interaction count so active volunteers don't get
-- penalized. Use log scale instead of inverse.
-- ══════════════════════════════════════

-- ══════════════════════════════════════
-- BUG FIX C: Prevent booked_slots race conditions
-- Add a check constraint function that validates slot counts
-- against actual booking count before allowing a booking.
-- This runs inside the transaction to prevent overbooking.
-- ══════════════════════════════════════

CREATE OR REPLACE FUNCTION validate_booking_slot_count()
RETURNS TRIGGER AS $$
DECLARE
  actual_booked integer;
  max_slots integer;
BEGIN
  -- Count actual confirmed bookings for this shift
  SELECT COUNT(*) INTO actual_booked
  FROM public.shift_bookings
  WHERE shift_id = NEW.shift_id
    AND booking_status = 'confirmed';

  -- Get total slots
  SELECT total_slots INTO max_slots
  FROM public.shifts
  WHERE id = NEW.shift_id
  FOR UPDATE; -- Lock the row to prevent concurrent reads

  IF actual_booked >= max_slots THEN
    RAISE EXCEPTION 'Shift is fully booked (% of % slots taken)', actual_booked, max_slots;
  END IF;

  -- Sync the booked_slots count while we're here
  UPDATE public.shifts
  SET booked_slots = actual_booked
  WHERE id = NEW.shift_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only fire on new confirmed bookings
DROP TRIGGER IF EXISTS trg_validate_booking_slots ON public.shift_bookings;
CREATE TRIGGER trg_validate_booking_slots
  BEFORE INSERT ON public.shift_bookings
  FOR EACH ROW
  WHEN (NEW.booking_status = 'confirmed')
  EXECUTE FUNCTION validate_booking_slot_count();

-- ══════════════════════════════════════
-- BUG FIX B: Fix recommendation novelty score
-- ══════════════════════════════════════

CREATE OR REPLACE FUNCTION score_shifts_for_volunteer(
  p_volunteer_id uuid,
  p_limit integer DEFAULT 20
)
RETURNS TABLE(
  shift_id uuid,
  shift_title text,
  shift_date date,
  department_id uuid,
  department_name text,
  start_time time,
  end_time time,
  time_type text,
  total_slots integer,
  booked_slots integer,
  requires_bg_check boolean,
  preference_score numeric,
  org_need_score numeric,
  novelty_score numeric,
  final_score numeric
) AS $$
DECLARE
  v_prefs record;
  v_max_interactions integer;
BEGIN
  -- Get volunteer preferences
  SELECT * INTO v_prefs
  FROM public.volunteer_preferences
  WHERE volunteer_id = p_volunteer_id;

  -- Get max interaction count for normalization (capped at 50 to prevent penalizing active users)
  SELECT LEAST(COALESCE(MAX(cnt), 1), 50) INTO v_max_interactions
  FROM (
    SELECT COUNT(*) as cnt
    FROM public.volunteer_shift_interactions
    WHERE volunteer_id = p_volunteer_id
    GROUP BY shift_id
  ) sub;

  RETURN QUERY
  WITH shift_interactions AS (
    SELECT
      vsi.shift_id,
      COUNT(*) as interaction_count
    FROM public.volunteer_shift_interactions vsi
    WHERE vsi.volunteer_id = p_volunteer_id
    GROUP BY vsi.shift_id
  ),
  available_shifts AS (
    SELECT
      s.id,
      s.title,
      s.shift_date,
      s.department_id,
      d.name as dept_name,
      s.start_time,
      s.end_time,
      s.time_type::text,
      s.total_slots,
      s.booked_slots,
      s.requires_bg_check,
      COALESCE(si.interaction_count, 0) as interactions
    FROM public.shifts s
    JOIN public.departments d ON d.id = s.department_id
    LEFT JOIN shift_interactions si ON si.shift_id = s.id
    WHERE s.status = 'open'
      AND s.shift_date >= CURRENT_DATE
      AND s.shift_date <= CURRENT_DATE + interval '21 days'
      AND s.booked_slots < s.total_slots
      -- Exclude shifts already booked by this volunteer
      AND NOT EXISTS (
        SELECT 1 FROM public.shift_bookings sb
        WHERE sb.shift_id = s.id
          AND sb.volunteer_id = p_volunteer_id
          AND sb.booking_status = 'confirmed'
      )
  )
  SELECT
    a.id,
    a.title,
    a.shift_date,
    a.department_id,
    a.dept_name,
    a.start_time,
    a.end_time,
    a.time_type,
    a.total_slots,
    a.booked_slots,
    a.requires_bg_check,
    -- Preference score (0-1): based on department affinity
    COALESCE(
      (v_prefs.department_affinity->>(a.department_id::text))::numeric / 100.0,
      0.5
    ) as preference_score,
    -- Org need score (0-1): inverse of fill ratio (empty shifts score higher)
    CASE WHEN a.total_slots > 0
      THEN 1.0 - (a.booked_slots::numeric / a.total_slots::numeric)
      ELSE 0.5
    END as org_need_score,
    -- Novelty score (0-1): logarithmic decay instead of inverse
    -- Active volunteers get a floor of 0.3 instead of approaching 0
    GREATEST(
      1.0 - (ln(1 + a.interactions) / ln(1 + v_max_interactions)),
      0.3
    ) as novelty_score,
    -- Final weighted score
    (
      COALESCE((v_prefs.department_affinity->>(a.department_id::text))::numeric / 100.0, 0.5) * 0.5
      + (CASE WHEN a.total_slots > 0 THEN 1.0 - (a.booked_slots::numeric / a.total_slots::numeric) ELSE 0.5 END) * 0.3
      + GREATEST(1.0 - (ln(1 + a.interactions) / ln(1 + v_max_interactions)), 0.3) * 0.2
    ) as final_score
  FROM available_shifts a
  ORDER BY final_score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
