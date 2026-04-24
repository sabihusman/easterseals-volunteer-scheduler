-- FK cascade audit for profiles.id
--
-- Establishes consistent cascade semantics across all 33 FKs that
-- reference public.profiles(id). Before this migration, 24 of those
-- FKs had no explicit ON DELETE rule (default NO ACTION), producing
-- cascade failures whenever an admin tried to delete a user with any
-- related data. Most recently observed on Apr 23 attempting to delete
-- anam@live.ca — `shift_bookings.volunteer_id` was the surfaced FK,
-- but it was one of many that would fail in sequence.
--
-- Philosophy:
--   CASCADE    — child rows are conceptually owned by the user and
--                should vanish with them (ephemeral queues, user-
--                owned settings, invitations-to-them, PII-scoped data)
--   SET NULL   — child rows represent historical or audit events that
--                must persist for reporting/accountability but whose
--                user reference should be anonymized
--   (unchanged) — 9 FKs already have the right rule (CASCADE); not
--                touched
--
-- FK rule table (33 total, 24 touched here):
--   Unchanged (9): conversation_participants, department_coordinators,
--     department_restrictions.volunteer_id, mfa_backup_codes,
--     notifications, parental_consents, shift_invitations.volunteer_id,
--     volunteer_documents.volunteer_id, volunteer_private_notes.volunteer_id
--   CASCADE     (1): confirmation_reminders.recipient_id
--   SET NULL   (23): see ALTER TABLE block below
--
-- 18 of the 23 SET NULL targets are currently NOT NULL. Those columns
-- need `ALTER COLUMN ... DROP NOT NULL` before the FK rule can become
-- SET NULL. Verified against the Apr 19 production schema dump.
--
-- Trigger update: cancel_bookings_on_profile_delete() previously only
-- cancelled 'confirmed' bookings. Extending to 'waitlisted' closes the
-- gap where a deleted user's waitlist offers would linger orphaned.
--
-- No frontend-visible behavior change for live users. After a user
-- deletion, historical rows (bookings, messages, notes, etc.) persist
-- with NULL user refs. Any reports/views must handle NULL gracefully —
-- see companion frontend fixes in the same PR.

BEGIN;

-- ---------------------------------------------------------------------
-- 1. DROP NOT NULL (18 columns)
-- ---------------------------------------------------------------------
-- admin_action_log
ALTER TABLE public.admin_action_log ALTER COLUMN admin_id DROP NOT NULL;
ALTER TABLE public.admin_action_log ALTER COLUMN volunteer_id DROP NOT NULL;

-- attendance_disputes (admin_decided_by already nullable; skip)
ALTER TABLE public.attendance_disputes ALTER COLUMN coordinator_id DROP NOT NULL;
ALTER TABLE public.attendance_disputes ALTER COLUMN volunteer_id DROP NOT NULL;

-- conversations
ALTER TABLE public.conversations ALTER COLUMN created_by DROP NOT NULL;

-- department_restrictions (volunteer_id stays NOT NULL — still CASCADE)
ALTER TABLE public.department_restrictions ALTER COLUMN restricted_by DROP NOT NULL;

-- document_types
ALTER TABLE public.document_types ALTER COLUMN created_by DROP NOT NULL;

-- event_registrations
ALTER TABLE public.event_registrations ALTER COLUMN volunteer_id DROP NOT NULL;

-- events
ALTER TABLE public.events ALTER COLUMN created_by DROP NOT NULL;

-- messages
ALTER TABLE public.messages ALTER COLUMN sender_id DROP NOT NULL;

-- private_note_access_log
ALTER TABLE public.private_note_access_log ALTER COLUMN admin_user_id DROP NOT NULL;
ALTER TABLE public.private_note_access_log ALTER COLUMN volunteer_id DROP NOT NULL;

-- shift_attachments
ALTER TABLE public.shift_attachments ALTER COLUMN uploader_id DROP NOT NULL;

-- shift_bookings (confirmed_by, coordinator_actioned_by already nullable; skip)
-- volunteer_id is the one that surfaced the production bug.
ALTER TABLE public.shift_bookings ALTER COLUMN volunteer_id DROP NOT NULL;

-- shift_invitations (volunteer_id already nullable; skip — it's also CASCADE)
ALTER TABLE public.shift_invitations ALTER COLUMN invited_by DROP NOT NULL;

-- shift_notes
ALTER TABLE public.shift_notes ALTER COLUMN author_id DROP NOT NULL;

-- shift_recurrence_rules
ALTER TABLE public.shift_recurrence_rules ALTER COLUMN created_by DROP NOT NULL;

-- shifts
ALTER TABLE public.shifts ALTER COLUMN created_by DROP NOT NULL;

-- volunteer_documents (reviewed_by already nullable; skip. volunteer_id stays CASCADE.)
-- volunteer_shift_reports
ALTER TABLE public.volunteer_shift_reports ALTER COLUMN volunteer_id DROP NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Change 23 FKs to ON DELETE SET NULL
-- ---------------------------------------------------------------------
-- admin_action_log
ALTER TABLE public.admin_action_log
  DROP CONSTRAINT admin_action_log_admin_id_fkey,
  ADD  CONSTRAINT admin_action_log_admin_id_fkey
    FOREIGN KEY (admin_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.admin_action_log
  DROP CONSTRAINT admin_action_log_volunteer_id_fkey,
  ADD  CONSTRAINT admin_action_log_volunteer_id_fkey
    FOREIGN KEY (volunteer_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- attendance_disputes
ALTER TABLE public.attendance_disputes
  DROP CONSTRAINT attendance_disputes_admin_decided_by_fkey,
  ADD  CONSTRAINT attendance_disputes_admin_decided_by_fkey
    FOREIGN KEY (admin_decided_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.attendance_disputes
  DROP CONSTRAINT attendance_disputes_coordinator_id_fkey,
  ADD  CONSTRAINT attendance_disputes_coordinator_id_fkey
    FOREIGN KEY (coordinator_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.attendance_disputes
  DROP CONSTRAINT attendance_disputes_volunteer_id_fkey,
  ADD  CONSTRAINT attendance_disputes_volunteer_id_fkey
    FOREIGN KEY (volunteer_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- conversations
ALTER TABLE public.conversations
  DROP CONSTRAINT conversations_created_by_fkey,
  ADD  CONSTRAINT conversations_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- department_restrictions (only restricted_by; volunteer_id stays CASCADE)
ALTER TABLE public.department_restrictions
  DROP CONSTRAINT department_restrictions_restricted_by_fkey,
  ADD  CONSTRAINT department_restrictions_restricted_by_fkey
    FOREIGN KEY (restricted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- document_types
ALTER TABLE public.document_types
  DROP CONSTRAINT document_types_created_by_fkey,
  ADD  CONSTRAINT document_types_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- event_registrations
ALTER TABLE public.event_registrations
  DROP CONSTRAINT event_registrations_volunteer_id_fkey,
  ADD  CONSTRAINT event_registrations_volunteer_id_fkey
    FOREIGN KEY (volunteer_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- events
ALTER TABLE public.events
  DROP CONSTRAINT events_created_by_fkey,
  ADD  CONSTRAINT events_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- messages
ALTER TABLE public.messages
  DROP CONSTRAINT messages_sender_id_fkey,
  ADD  CONSTRAINT messages_sender_id_fkey
    FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- private_note_access_log
ALTER TABLE public.private_note_access_log
  DROP CONSTRAINT private_note_access_log_admin_user_id_fkey,
  ADD  CONSTRAINT private_note_access_log_admin_user_id_fkey
    FOREIGN KEY (admin_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.private_note_access_log
  DROP CONSTRAINT private_note_access_log_volunteer_id_fkey,
  ADD  CONSTRAINT private_note_access_log_volunteer_id_fkey
    FOREIGN KEY (volunteer_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- shift_attachments
ALTER TABLE public.shift_attachments
  DROP CONSTRAINT shift_attachments_uploader_id_fkey,
  ADD  CONSTRAINT shift_attachments_uploader_id_fkey
    FOREIGN KEY (uploader_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- shift_bookings
ALTER TABLE public.shift_bookings
  DROP CONSTRAINT shift_bookings_confirmed_by_fkey,
  ADD  CONSTRAINT shift_bookings_confirmed_by_fkey
    FOREIGN KEY (confirmed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.shift_bookings
  DROP CONSTRAINT shift_bookings_coordinator_actioned_by_fkey,
  ADD  CONSTRAINT shift_bookings_coordinator_actioned_by_fkey
    FOREIGN KEY (coordinator_actioned_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.shift_bookings
  DROP CONSTRAINT shift_bookings_volunteer_id_fkey,
  ADD  CONSTRAINT shift_bookings_volunteer_id_fkey
    FOREIGN KEY (volunteer_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- shift_invitations (only invited_by; volunteer_id stays CASCADE)
ALTER TABLE public.shift_invitations
  DROP CONSTRAINT shift_invitations_invited_by_fkey,
  ADD  CONSTRAINT shift_invitations_invited_by_fkey
    FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- shift_notes
ALTER TABLE public.shift_notes
  DROP CONSTRAINT shift_notes_author_id_fkey,
  ADD  CONSTRAINT shift_notes_author_id_fkey
    FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- shift_recurrence_rules
ALTER TABLE public.shift_recurrence_rules
  DROP CONSTRAINT shift_recurrence_rules_created_by_fkey,
  ADD  CONSTRAINT shift_recurrence_rules_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- shifts
ALTER TABLE public.shifts
  DROP CONSTRAINT shifts_created_by_fkey,
  ADD  CONSTRAINT shifts_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- volunteer_documents (only reviewed_by; volunteer_id stays CASCADE)
ALTER TABLE public.volunteer_documents
  DROP CONSTRAINT volunteer_documents_reviewed_by_fkey,
  ADD  CONSTRAINT volunteer_documents_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- volunteer_shift_reports
ALTER TABLE public.volunteer_shift_reports
  DROP CONSTRAINT volunteer_shift_reports_volunteer_id_fkey,
  ADD  CONSTRAINT volunteer_shift_reports_volunteer_id_fkey
    FOREIGN KEY (volunteer_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- 3. Change 1 FK to ON DELETE CASCADE
-- ---------------------------------------------------------------------
-- confirmation_reminders: queue entries for a deleted user are moot
ALTER TABLE public.confirmation_reminders
  DROP CONSTRAINT confirmation_reminders_recipient_id_fkey,
  ADD  CONSTRAINT confirmation_reminders_recipient_id_fkey
    FOREIGN KEY (recipient_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
-- 4. Extend cancel_bookings_on_profile_delete() to cover waitlisted
-- ---------------------------------------------------------------------
-- Previously only cancelled 'confirmed' bookings. 'waitlisted' offers
-- would survive the delete and stay as orphaned waitlist entries. With
-- shift_bookings.volunteer_id now SET NULL on cascade, those would
-- become "waitlisted by nobody" — coherent enough structurally, but
-- the right behavior is to cancel them first so waitlist notifications
-- and the slot state are consistent.
CREATE OR REPLACE FUNCTION public.cancel_bookings_on_profile_delete()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF old.role = 'volunteer' THEN
    UPDATE public.shift_bookings
    SET booking_status = 'cancelled',
        cancelled_at = now(),
        updated_at = now()
    WHERE volunteer_id = old.id
      AND booking_status IN ('confirmed', 'waitlisted');
  END IF;
  RETURN old;
END;
$$;

COMMIT;
