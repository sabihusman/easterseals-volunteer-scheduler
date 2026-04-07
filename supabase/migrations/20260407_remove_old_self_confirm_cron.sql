-- =============================================
-- The new "unactioned-shift-volunteer-reminder" cron (added in
-- 20260407_unactioned_shifts.sql) replaces the older
-- "self-confirmation-reminder-job". Having both running in parallel
-- causes volunteers to get double notifications for the same shift.
-- Unschedule the older one now that the new one is in place.
-- =============================================
SELECT cron.unschedule('self-confirmation-reminder-job')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'self-confirmation-reminder-job');
