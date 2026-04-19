-- =============================================
-- Fix: consistency score should not show any value until the
-- volunteer has completed a minimum of 5 shifts. Previously the
-- function set score to 0 when total < 5, which displayed as "0%"
-- in the UI — misleading because it implies the volunteer has a
-- poor score rather than "not enough data yet."
--
-- Change: set consistency_score = NULL when total < 5. The frontend
-- interprets NULL as "not enough shifts" and shows "—" or the
-- "Complete 5 shifts to unlock..." message instead of a percentage.
-- =============================================

-- Allow NULL on consistency_score (was NOT NULL DEFAULT 0)
ALTER TABLE public.profiles ALTER COLUMN consistency_score DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.recalculate_consistency(p_volunteer_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  attended   int;
  total      int;
  score      numeric(5,2);
  extended   boolean;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE confirmation_status = 'confirmed'),
    COUNT(*)
  INTO attended, total
  FROM (
    SELECT confirmation_status
    FROM public.shift_bookings b
    JOIN public.shifts s ON s.id = b.shift_id
    WHERE b.volunteer_id = p_volunteer_id
      AND b.booking_status = 'confirmed'
      AND b.confirmation_status IN ('confirmed', 'no_show')
      AND s.shift_date <= current_date
    ORDER BY s.shift_date DESC
    LIMIT 5
  ) recent;

  -- Don't compute a score until the volunteer has at least 5
  -- completed shifts. NULL signals "not enough data" to the UI.
  IF total < 5 THEN
    score    := NULL;
    extended := false;
  ELSE
    score    := ROUND((attended::numeric / total) * 100, 2);
    extended := score >= 90;
  END IF;

  UPDATE public.profiles
  SET consistency_score = score,
      extended_booking  = extended,
      updated_at        = now()
  WHERE id = p_volunteer_id;
END;
$function$;
