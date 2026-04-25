-- Supersedes 20260423000000_guard_recalculate_points_during_delete.sql.
--
-- That previous guard checked `EXISTS (SELECT 1 FROM profiles WHERE id = volunteer_uuid)`,
-- which was the wrong table. During the cascading delete of a user:
--   - auth.users row is deleted first
--   - CASCADE on profiles.id_fkey queues the profiles row for deletion
--   - BEFORE DELETE trigger cancel_bookings_on_profile_delete fires — at this
--     point the profiles row is STILL VISIBLE in-transaction, so the
--     `EXISTS (profiles)` guard returned TRUE and the UPDATE proceeded
--   - The UPDATE triggered an FK recheck against profiles_id_fkey → auth.users
--   - auth.users parent row is already gone → FK violation (ERROR: 23503)
--
-- The correct check is `EXISTS (SELECT 1 FROM auth.users WHERE id = volunteer_uuid)`.
-- When auth.users is gone, the cascade is underway and any UPDATE on the child
-- profile row will fail FK recheck — so we must skip it.
--
-- Everything else (signature, SECURITY DEFINER, search_path, calculation
-- logic, error messages) preserved byte-for-byte from the previous version.

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

  -- Guard: skip the UPDATE when the auth.users parent row is gone. This is
  -- the signal that a cascading delete is underway — the profile row itself
  -- is still visible in-transaction (BEFORE DELETE trigger context), but any
  -- write to it would fail the FK recheck against the missing parent.
  -- See the file header for the full diagnosis.
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = volunteer_uuid) THEN
    UPDATE profiles SET volunteer_points = pts WHERE id = volunteer_uuid;
  END IF;
END;
$$;
