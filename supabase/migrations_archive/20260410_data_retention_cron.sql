-- =============================================
-- Data retention: prune stale read notifications.
--
-- The notifications table grows unbounded — every booking, message,
-- shift reminder, and system event inserts a row. Read notifications
-- have no further value after a few months. Without cleanup, the
-- table bloats and slows queries (particularly the bell dropdown
-- which filters is_read = false but still scans the full table on
-- Supabase's free/pro tier without partitioning).
--
-- This cron runs daily at 03:00 CT (08:00 UTC) and deletes
-- is_read = true notifications older than 90 days. Unread
-- notifications are NEVER deleted — they stay until the user
-- actions them or marks them read.
-- =============================================

SELECT cron.unschedule('prune-read-notifications')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-read-notifications');

SELECT cron.schedule(
  'prune-read-notifications',
  '0 8 * * *',   -- 03:00 CT = 08:00 UTC
  $cron$
  DELETE FROM public.notifications
  WHERE is_read = true
    AND created_at < now() - interval '90 days';
  $cron$
);
