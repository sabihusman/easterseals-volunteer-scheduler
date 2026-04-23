-- Fixes FK violation when deleting users with confirmed bookings.
-- Trigger chain: delete user → cascade to profiles → cancel_bookings_on_profile_delete fires
-- → trg_recalculate_points_fn fires → recalculate_points tries to UPDATE a profile row
-- whose parent auth.users row is being deleted in the same transaction. The guard
-- prevents the UPDATE when the target profile no longer exists.
-- Observed: Apr 23 2026, deleting anam@live.ca with confirmed bookings.
--
-- Byte-equivalent to the existing function body (baseline:1892–1913 plus the
-- search_path alter from 20260414000002_fix_security_advisor.sql:101) except
-- for the IF EXISTS guard wrapping the UPDATE.

CREATE OR REPLACE FUNCTION public.recalculate_points(volunteer_uuid uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
  AS $$
DECLARE
  pts integer := 0;
  shift_pts integer := 0;
  rating_pts integer := 0;
  milestone_pts integer := 0;
BEGIN
  SELECT COALESCE(SUM(COALESCE(final_hours, 0)) * 10, 0)::integer INTO shift_pts
  FROM shift_bookings
  WHERE volunteer_id = volunteer_uuid
    AND booking_status = 'confirmed'
    AND confirmation_status = 'confirmed';

  SELECT COALESCE(COUNT(*) * 5, 0)::integer INTO rating_pts
  FROM volunteer_shift_reports vsr
  JOIN shift_bookings sb ON vsr.booking_id = sb.id
  WHERE sb.volunteer_id = volunteer_uuid AND vsr.star_rating = 5;

  SELECT COALESCE(floor(total_hours / 10) * 25, 0)::integer INTO milestone_pts
  FROM profiles WHERE id = volunteer_uuid;

  pts := shift_pts + rating_pts + milestone_pts;

  -- Guard: only update if the profile still exists. Prevents FK violation
  -- when this function is called from a trigger during a cascading delete
  -- of the profile row (see file header comment).
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = volunteer_uuid) THEN
    UPDATE profiles SET volunteer_points = pts WHERE id = volunteer_uuid;
  END IF;
END;
$$;
