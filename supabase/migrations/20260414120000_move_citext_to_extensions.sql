-- =============================================================================
-- Migration: move_citext_to_extensions
-- Description: Move the citext extension out of the public schema into the
--   extensions schema, per Supabase Security Advisor recommendation. The
--   only dependent object is public.profiles.username (citext type) and one
--   function, public.username_available, that uses an unqualified ::citext
--   cast with search_path pinned to 'public'.
--
-- Strategy:
--   1. Drop the partial unique index on profiles.username
--   2. Convert profiles.username to text (preserves data; citext is text +
--      a different comparison operator, so casts are lossless)
--   3. ALTER EXTENSION citext SET SCHEMA extensions
--   4. Convert profiles.username back to extensions.citext
--   5. Recreate the partial unique index (btree picks up the citext
--      operator class automatically for the new column type)
--   6. CREATE OR REPLACE username_available with a fully-qualified cast
--      (::extensions.citext) AND pinned search_path = public, extensions
--      (belt-and-braces — either one alone would work)
--
-- Wrapped in a single transaction so there is no window where a concurrent
-- sign-up could fail on username_available.
-- =============================================================================

BEGIN;

-- 1. Ensure the target schema exists. Supabase projects provision this
--    by default; the IF NOT EXISTS guard makes the migration idempotent
--    against environments where it's already been created.
CREATE SCHEMA IF NOT EXISTS extensions;

-- 2. Drop the partial unique index. ALTER COLUMN TYPE would fail otherwise
--    because an index directly references the column's current type.
DROP INDEX IF EXISTS public.profiles_username_unique_idx;

-- 3. Convert the column to plain text. USING username::text is lossless
--    because citext values ARE text internally; only the comparison
--    operator differs. This rewrites the table — brief ACCESS EXCLUSIVE
--    lock on profiles. Acceptable: profiles is small (one row per user).
ALTER TABLE public.profiles
  ALTER COLUMN username TYPE text USING username::text;

-- 4. Move the extension. With the column now a plain text type, there
--    are no remaining hard dependencies (pg_depend entries) on the
--    public.citext type, so the move succeeds.
ALTER EXTENSION citext SET SCHEMA extensions;

-- 5. Convert the column back to citext — now sourced from extensions.
ALTER TABLE public.profiles
  ALTER COLUMN username TYPE extensions.citext USING username::extensions.citext;

-- 6. Recreate the partial unique index. btree on an extensions.citext
--    column automatically uses the citext operator class (case-
--    insensitive comparison) just as it did when the extension lived
--    in public.
CREATE UNIQUE INDEX profiles_username_unique_idx
  ON public.profiles USING btree (username)
  WHERE (username IS NOT NULL);

-- 7. Fix public.username_available. Two independent changes, both
--    applied for safety:
--    (a) Qualify the cast as ::extensions.citext — resolves regardless
--        of search_path.
--    (b) Pin search_path = public, extensions — so any future
--        unqualified references (citext literals, operators) also
--        resolve cleanly.
--    Preserves the original STABLE + SECURITY DEFINER characteristics.
CREATE OR REPLACE FUNCTION public.username_available(p_username text)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, extensions
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
     WHERE username = trim(p_username)::extensions.citext
  );
END;
$$;

ALTER FUNCTION public.username_available(text) OWNER TO postgres;

GRANT ALL ON FUNCTION public.username_available(text) TO anon;
GRANT ALL ON FUNCTION public.username_available(text) TO authenticated;
GRANT ALL ON FUNCTION public.username_available(text) TO service_role;

COMMIT;
