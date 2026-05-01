-- ===========================================================================
-- RLS test harness — non-user fixtures.
-- ===========================================================================
--
-- This file seeds infrastructure rows that don't depend on auth.users
-- existing first: a test department, and any other lookup data tests need
-- to reference. User creation (auth.users + profiles) happens in TypeScript
-- setup (supabase/test/setup.ts) via supabase.auth.admin.createUser, which
-- bypasses email-confirmation requirements that direct INSERTs would skip.
--
-- Idempotency: ON CONFLICT DO NOTHING for every INSERT so re-running this
-- file (e.g. after `supabase db reset`) doesn't error.
--
-- Cron suppression: pg_cron jobs created during migration apply may fire
-- during tests and mutate state in ways the tests don't expect. We
-- unschedule everything here. The migrations re-create them on the next
-- `supabase db reset`, so this is per-run.
-- ===========================================================================

-- ── Cron suppression ──
-- pg_cron may not be installed on the local Supabase stack depending on
-- CLI version. The DO block tolerates either presence or absence.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobname)
    FROM cron.job
    WHERE jobname IS NOT NULL;
  END IF;
END $$;

-- ── Test department ──
-- Stable UUID so tests can reference it directly without a lookup.
INSERT INTO public.locations (id, name, is_active, timezone)
VALUES (
  '00000000-0000-0000-0000-000000000100',
  'Test Location',
  true,
  'America/Chicago'
) ON CONFLICT (id) DO NOTHING;

-- Half B-1: dropped departments.min_age column. Fixture insert no
-- longer references it.
INSERT INTO public.departments (id, name, location_id, is_active, requires_bg_check, allows_groups)
VALUES (
  '00000000-0000-0000-0000-000000000200',
  'Test Department',
  '00000000-0000-0000-0000-000000000100',
  true,
  false,
  false
) ON CONFLICT (id) DO NOTHING;
