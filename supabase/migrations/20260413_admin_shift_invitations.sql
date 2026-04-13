-- ============================================================
-- Admin Shift Invitations
-- ============================================================
-- Extends the existing shift_invitations table (used for friend
-- invites) with a volunteer_id column for admin-to-volunteer
-- direct invitations. Adds RLS, a unique constraint, and a cron
-- job to expire stale invitations.
-- ============================================================

-- ── 1. Add volunteer_id column ──────────────────────────────
ALTER TABLE public.shift_invitations
  ADD COLUMN IF NOT EXISTS volunteer_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

-- ── 2. Unique constraint: one pending admin invitation per volunteer per shift ──
-- NULL volunteer_id rows (friend invites) are ignored by unique indexes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_invitation_volunteer
  ON public.shift_invitations (shift_id, volunteer_id)
  WHERE volunteer_id IS NOT NULL AND status = 'pending';

-- ── 3. Ensure 'declined' is a valid status ──────────────────
-- Drop the old check constraint and recreate with 'declined'.
DO $$
BEGIN
  -- Find and drop the existing status check constraint
  PERFORM 1
    FROM information_schema.table_constraints
   WHERE table_name = 'shift_invitations'
     AND constraint_type = 'CHECK'
     AND constraint_name LIKE '%status%';
  IF FOUND THEN
    EXECUTE (
      SELECT 'ALTER TABLE public.shift_invitations DROP CONSTRAINT ' || constraint_name
        FROM information_schema.table_constraints
       WHERE table_name = 'shift_invitations'
         AND constraint_type = 'CHECK'
         AND constraint_name LIKE '%status%'
       LIMIT 1
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL; -- no constraint to drop
END $$;

ALTER TABLE public.shift_invitations
  ADD CONSTRAINT shift_invitations_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'expired'));

-- ── 4. RLS policies ─────────────────────────────────────────
ALTER TABLE public.shift_invitations ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any so this migration is idempotent
DROP POLICY IF EXISTS "Admins can manage all invitations" ON public.shift_invitations;
DROP POLICY IF EXISTS "Volunteers can read own invitations" ON public.shift_invitations;
DROP POLICY IF EXISTS "Volunteers can update own invitation status" ON public.shift_invitations;
DROP POLICY IF EXISTS "Coordinators can insert invitations" ON public.shift_invitations;
DROP POLICY IF EXISTS "Anyone can insert invitations" ON public.shift_invitations;

-- Admins: full access
CREATE POLICY "Admins can manage all invitations"
  ON public.shift_invitations
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Volunteers: can read their own invitations
CREATE POLICY "Volunteers can read own invitations"
  ON public.shift_invitations
  FOR SELECT
  USING (volunteer_id = auth.uid() OR invited_by = auth.uid());

-- Volunteers: can update status on their own invitations
CREATE POLICY "Volunteers can update own invitation status"
  ON public.shift_invitations
  FOR UPDATE
  USING (volunteer_id = auth.uid())
  WITH CHECK (volunteer_id = auth.uid());

-- Allow authenticated users to insert (for friend invites via invited_by)
CREATE POLICY "Authenticated users can insert invitations"
  ON public.shift_invitations
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ── 5. Cron: expire stale invitations ───────────────────────
-- Runs every 15 minutes. Marks pending invitations as expired
-- once their expires_at timestamp has passed.
SELECT cron.unschedule('expire-shift-invitations')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'expire-shift-invitations'
  );

SELECT cron.schedule(
  'expire-shift-invitations',
  '*/15 * * * *',
  $$
    UPDATE public.shift_invitations
       SET status = 'expired'
     WHERE status = 'pending'
       AND expires_at < now();
  $$
);
