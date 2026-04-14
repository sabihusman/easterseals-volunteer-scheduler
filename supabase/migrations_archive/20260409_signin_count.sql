-- =============================================
-- Track how many times a user has signed in.
-- Used by the onboarding modal to decide whether to display:
--   show if signin_count <= 3 AND onboarding_complete = false
-- =============================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS signin_count integer NOT NULL DEFAULT 0;
