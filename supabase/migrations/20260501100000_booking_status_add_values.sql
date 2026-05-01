-- =============================================
-- Half B-1 — Step 1 of 2: extend the booking_status enum
--
-- Postgres limitation: a value added via `ALTER TYPE ... ADD VALUE`
-- cannot be referenced in DDL (CREATE INDEX, CREATE POLICY, function
-- bodies that compare to the value) within the same transaction.
-- This file does only the ADD VALUE statements; everything that
-- references the new values lives in 20260501100001_minor_approval_queue.sql.
--
-- New values:
--   'pending_admin_approval' — minor's booking awaiting admin approval.
--                              Inserted by trg_route_minor_to_pending
--                              (defined in step-2 migration). Does not
--                              count toward booked_slots; admin queue
--                              page lists these for approve/deny.
--   'rejected'              — admin denied a pending minor booking.
--                              The volunteer-side UI hides rejected
--                              bookings from the volunteer's own view
--                              (denial notification carries the reason).
-- =============================================

ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'pending_admin_approval';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'rejected';
