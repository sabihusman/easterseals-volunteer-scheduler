-- =============================================
-- Privacy: coordinators/admins can only see aggregate ratings
-- (avg + count) where 2+ volunteers have rated. Individual
-- star_rating and shift_feedback values must never be readable
-- by anyone other than the volunteer who wrote them.
-- =============================================

-- Aggregate function: takes an array of shift IDs, returns avg + count
-- but only for shifts that have 2+ ratings. SECURITY DEFINER bypasses
-- the column-level revoke below for the aggregation logic only.
CREATE OR REPLACE FUNCTION public.get_shift_rating_aggregates(shift_uuids uuid[])
RETURNS TABLE (
  shift_id uuid,
  avg_rating numeric,
  rating_count integer
) LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
BEGIN
  IF NOT public.is_coordinator_or_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    sb.shift_id,
    ROUND(AVG(vsr.star_rating)::numeric, 1) AS avg_rating,
    COUNT(vsr.star_rating)::integer AS rating_count
  FROM public.volunteer_shift_reports vsr
  JOIN public.shift_bookings sb ON sb.id = vsr.booking_id
  WHERE sb.shift_id = ANY(shift_uuids)
    AND vsr.star_rating IS NOT NULL
  GROUP BY sb.shift_id
  HAVING COUNT(vsr.star_rating) >= 2;
END;
$$;

-- Grant execute on the aggregate function to authenticated users
GRANT EXECUTE ON FUNCTION public.get_shift_rating_aggregates(uuid[]) TO authenticated;

-- Revoke direct SELECT on the privacy-sensitive columns from authenticated.
-- Volunteers still access their own rows via the existing volunteer-only
-- RLS policy (which uses the SELECT * grant on the table). We only block
-- the direct read path that coordinators were using.
-- NOTE: Postgres column-level revokes only apply when the user does
-- NOT have table-level SELECT. Since we use RLS with full SELECT grants,
-- we instead handle this at the application layer by:
--   1. Never querying star_rating / shift_feedback from the frontend
--      as a coordinator (already true after this commit).
--   2. Providing the aggregate function as the only sanctioned access path.
-- The volunteer-only RLS policy still enforces privacy at the row level
-- because coordinator queries that try to read another volunteer's row
-- return 0 rows.

-- Let me re-check: the existing "reports: coord read confirmation" policy
-- uses USING (is_coordinator_or_admin()) which OVERRIDES the volunteer-only
-- row filter for staff. THAT is the actual leak. We need to keep coordinator
-- read access for self_confirm_status and self_reported_hours (needed for
-- hours reconciliation) but block reading of star_rating and shift_feedback.
--
-- The cleanest solution: drop the broad coord read policy and replace with
-- a narrower one that coordinators can read everything EXCEPT star_rating
-- and shift_feedback. Postgres doesn't support column-level RLS, but we can
-- use a security barrier VIEW.

-- Step 1: Create a sanitized view that exposes everything coordinators
-- legitimately need (status + hours) but excludes the private fields.
CREATE OR REPLACE VIEW public.volunteer_shift_reports_safe
WITH (security_barrier = true) AS
SELECT
  id,
  booking_id,
  volunteer_id,
  self_confirm_status,
  self_reported_hours,
  reminder_sent_at,
  submitted_at,
  created_at,
  updated_at
  -- Deliberately excluded: star_rating, shift_feedback
FROM public.volunteer_shift_reports;

GRANT SELECT ON public.volunteer_shift_reports_safe TO authenticated;

-- Step 2: Drop the broad coordinator read policy on the underlying table
DROP POLICY IF EXISTS "reports: coord read confirmation" ON public.volunteer_shift_reports;

-- Coordinators now read via the safe view (no star_rating exposed)
-- and via get_shift_rating_aggregates() for ratings.
-- The volunteer-only RLS policy (volunteer_id = auth.uid()) still allows
-- volunteers to read their own complete row including star_rating.
