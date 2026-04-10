-- =============================================
-- Performance indexes for cron jobs and high-frequency triggers.
--
-- Without these, the daily/hourly crons and the per-booking
-- sync_booked_slots trigger do sequential scans that degrade
-- as the tables grow. Each index targets a specific query path.
--
-- All indexes use IF NOT EXISTS so the migration is idempotent.
-- =============================================

-- 1. Cron: unactioned-shift-auto-delete + unactioned-shift-volunteer-reminder
--    Both filter on confirmation_status = 'pending_confirmation' AND
--    booking_status = 'confirmed'. This composite index covers the
--    exact WHERE clause so the cron can index-scan instead of seq-scan.
CREATE INDEX IF NOT EXISTS idx_bookings_confirmation_status
  ON public.shift_bookings (confirmation_status, booking_status);

-- 2. Trigger: sync_booked_slots + validate_booking_slot_count
--    Both COUNT(*) WHERE shift_id = X AND booking_status = 'confirmed'.
--    This composite index lets the count aggregate use an index-only
--    scan per shift, which matters when many bookings accumulate.
CREATE INDEX IF NOT EXISTS idx_bookings_shift_status
  ON public.shift_bookings (shift_id, booking_status);

-- 3. Cron: prune-read-notifications (data retention)
--    Deletes WHERE is_read = true AND created_at < now() - 90 days.
--    Without this index the daily prune does a full table scan on
--    notifications, which is the single largest table in the system.
CREATE INDEX IF NOT EXISTS idx_notifications_read_age
  ON public.notifications (is_read, created_at)
  WHERE is_read = true;
