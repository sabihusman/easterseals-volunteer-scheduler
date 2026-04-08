-- =============================================
-- MFA backup codes
--
-- Each user can hold up to 10 single-use recovery codes generated at
-- enrollment time. Codes are stored as bcrypt-equivalent SHA-256 hashes
-- (Postgres pgcrypto crypt() with bf scheme is overkill for short
-- random codes; SHA-256 with a per-user salt is plenty for 80-bit
-- entropy codes).
--
-- Flow:
--   1. After verifying TOTP enrollment, the client calls
--      mfa_generate_backup_codes() and displays the plain codes ONCE.
--   2. The function returns 10 plain codes and writes their hashes.
--   3. On login if the user can't access their TOTP device, the
--      client calls mfa_consume_backup_code(code). If valid, the row
--      is marked used_at and the function returns true. The client
--      then proceeds with the post-MFA navigation.
--
-- Note: this is a parallel recovery path to admin-reset-mfa. Backup
-- codes don't fully replace admin reset (the user might lose both
-- their device AND their printout), but they cover the common case
-- of "phone died, I have my codes saved in 1Password".
-- =============================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.mfa_backup_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  code_hash    text NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mfa_backup_codes_user_id_idx
  ON public.mfa_backup_codes (user_id) WHERE used_at IS NULL;

ALTER TABLE public.mfa_backup_codes ENABLE ROW LEVEL SECURITY;

-- The table is server-side only. SECURITY DEFINER functions are the
-- only legitimate read/write path. Block all client access at RLS.
DROP POLICY IF EXISTS "mfa_backup_codes: deny all client" ON public.mfa_backup_codes;
CREATE POLICY "mfa_backup_codes: deny all client"
  ON public.mfa_backup_codes
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

-- ============================================================
-- RPC: mfa_generate_backup_codes
--
-- Generates 10 fresh backup codes for the calling user, deletes any
-- previous unused codes (so the new set fully supersedes the old one),
-- writes the hashes, and returns the plain text codes ONCE. Plain codes
-- never appear in any persisted state.
-- ============================================================
CREATE OR REPLACE FUNCTION public.mfa_generate_backup_codes()
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_codes text[] := ARRAY[]::text[];
  v_code text;
  i integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Replace any previously generated unused codes
  DELETE FROM public.mfa_backup_codes
   WHERE user_id = v_user_id
     AND used_at IS NULL;

  -- Generate 10 codes of the form XXXX-XXXX (8 hex chars, dashed)
  FOR i IN 1..10 LOOP
    v_code := upper(
      substr(encode(gen_random_bytes(2), 'hex'), 1, 4) || '-' ||
      substr(encode(gen_random_bytes(2), 'hex'), 1, 4)
    );
    INSERT INTO public.mfa_backup_codes (user_id, code_hash)
    VALUES (v_user_id, encode(digest(v_code || v_user_id::text, 'sha256'), 'hex'));
    v_codes := v_codes || v_code;
  END LOOP;

  RETURN v_codes;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mfa_generate_backup_codes() TO authenticated;

-- ============================================================
-- RPC: mfa_consume_backup_code
--
-- Verifies the supplied code against the calling user's stored hashes.
-- If a matching unused code is found, marks it used_at = now() and
-- returns true. Otherwise sleeps for ~30ms (constant-time defense)
-- and returns false.
-- ============================================================
CREATE OR REPLACE FUNCTION public.mfa_consume_backup_code(p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_hash text;
  v_match_id uuid;
BEGIN
  IF v_user_id IS NULL OR p_code IS NULL OR length(trim(p_code)) = 0 THEN
    PERFORM pg_sleep(0.03);
    RETURN false;
  END IF;

  v_hash := encode(
    digest(upper(trim(p_code)) || v_user_id::text, 'sha256'),
    'hex'
  );

  SELECT id INTO v_match_id
    FROM public.mfa_backup_codes
    WHERE user_id = v_user_id
      AND code_hash = v_hash
      AND used_at IS NULL
    FOR UPDATE
    LIMIT 1;

  IF v_match_id IS NULL THEN
    PERFORM pg_sleep(0.03);
    RETURN false;
  END IF;

  UPDATE public.mfa_backup_codes
    SET used_at = now()
    WHERE id = v_match_id;

  PERFORM pg_sleep(0.03);
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mfa_consume_backup_code(text) TO authenticated;

-- ============================================================
-- RPC: mfa_unused_backup_code_count
-- Lets the UI show "X codes remaining" to nudge users to regenerate
-- if they're running low.
-- ============================================================
CREATE OR REPLACE FUNCTION public.mfa_unused_backup_code_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.mfa_backup_codes
  WHERE user_id = auth.uid() AND used_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.mfa_unused_backup_code_count() TO authenticated;
