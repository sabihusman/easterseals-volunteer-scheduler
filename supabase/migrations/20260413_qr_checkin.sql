-- ============================================================
-- QR Code Check-In
-- ============================================================
-- Universal QR code at the front desk. Volunteers scan, authenticate,
-- get matched to their shift, and check in with one tap.
-- ============================================================

-- ── 1. checkin_tokens table ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.checkin_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token       text UNIQUE NOT NULL,
  is_active   boolean DEFAULT true,
  rotation_mode text CHECK (rotation_mode IN ('none', 'daily', 'weekly', 'monthly')) DEFAULT 'none',
  created_at  timestamptz DEFAULT now(),
  expires_at  timestamptz
);

ALTER TABLE public.checkin_tokens ENABLE ROW LEVEL SECURITY;

-- Only admins can read/write checkin_tokens
CREATE POLICY "Admins can manage checkin_tokens"
  ON public.checkin_tokens FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- ── 2. Public RPC for token validation ──────────────────────
-- Returns true/false without exposing the table to anon users.
CREATE OR REPLACE FUNCTION public.validate_checkin_token(p_token text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.checkin_tokens
     WHERE token = p_token
       AND is_active = true
       AND (expires_at IS NULL OR expires_at > now())
  );
$$;

-- Grant execute to anon + authenticated so the /checkin page works
GRANT EXECUTE ON FUNCTION public.validate_checkin_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.validate_checkin_token(text) TO authenticated;

-- ── 3. Add checked_in column if not present ─────────────────
-- checked_in_at already exists. Add a boolean convenience column.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'shift_bookings' AND column_name = 'checked_in'
  ) THEN
    ALTER TABLE public.shift_bookings ADD COLUMN checked_in boolean DEFAULT false;
  END IF;
END $$;

-- Back-fill: if checked_in_at is set, mark checked_in = true
UPDATE public.shift_bookings
   SET checked_in = true
 WHERE checked_in_at IS NOT NULL AND checked_in = false;

-- ── 4. Cron: rotate checkin tokens ──────────────────────────
-- Runs every hour. For each active token with rotation, checks if
-- the token's created_at is older than the rotation window. If so,
-- expires the old token and creates a new one.
SELECT cron.unschedule('rotate-checkin-tokens')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rotate-checkin-tokens');

SELECT cron.schedule(
  'rotate-checkin-tokens',
  '0 * * * *',
  $$
    -- Expire tokens that have exceeded their rotation window
    UPDATE public.checkin_tokens
       SET is_active = false,
           expires_at = COALESCE(expires_at, now())
     WHERE is_active = true
       AND rotation_mode != 'none'
       AND (
         (rotation_mode = 'daily'   AND created_at < now() - interval '1 day')
         OR (rotation_mode = 'weekly'  AND created_at < now() - interval '1 week')
         OR (rotation_mode = 'monthly' AND created_at < now() - interval '1 month')
       );

    -- Create replacement tokens for any that were just expired,
    -- but only if there's no other active token already.
    INSERT INTO public.checkin_tokens (token, is_active, rotation_mode)
    SELECT gen_random_uuid()::text, true, ct.rotation_mode
      FROM public.checkin_tokens ct
     WHERE ct.is_active = false
       AND ct.expires_at >= now() - interval '1 hour'
       AND ct.rotation_mode != 'none'
       AND NOT EXISTS (
         SELECT 1 FROM public.checkin_tokens ct2
          WHERE ct2.is_active = true
       )
     LIMIT 1;
  $$
);
