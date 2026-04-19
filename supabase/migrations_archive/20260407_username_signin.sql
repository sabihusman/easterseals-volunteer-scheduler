-- =============================================
-- Username sign-in: allow users to log in with username OR email
-- =============================================

-- Enable case-insensitive text type
CREATE EXTENSION IF NOT EXISTS citext;

-- Add username column to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username citext;

-- Enforce uniqueness (case-insensitive via citext)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique_idx
  ON public.profiles (username)
  WHERE username IS NOT NULL;

-- Validation: 3-30 chars, alphanumeric + underscore
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_username_format_chk;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_format_chk
  CHECK (username IS NULL OR (length(username::text) BETWEEN 3 AND 30 AND username::text ~ '^[A-Za-z0-9_]+$'));

-- =============================================
-- Lookup function: resolve username -> email
-- SECURITY DEFINER so anonymous login flow can use it
-- without exposing the entire profiles table.
-- =============================================
CREATE OR REPLACE FUNCTION public.get_email_by_username(p_username text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  IF p_username IS NULL OR length(trim(p_username)) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT email
    INTO v_email
    FROM public.profiles
   WHERE username = trim(p_username)::citext
   LIMIT 1;

  RETURN v_email;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_email_by_username(text) TO anon, authenticated;

-- =============================================
-- Username availability check (for signup)
-- =============================================
CREATE OR REPLACE FUNCTION public.username_available(p_username text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_username IS NULL OR length(trim(p_username)) = 0 THEN
    RETURN false;
  END IF;

  -- Format check
  IF NOT (length(trim(p_username)) BETWEEN 3 AND 30
          AND trim(p_username) ~ '^[A-Za-z0-9_]+$') THEN
    RETURN false;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE username = trim(p_username)::citext
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.username_available(text) TO anon, authenticated;
