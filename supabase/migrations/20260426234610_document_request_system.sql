-- ===========================================================================
-- Document Request & Upload System — Phase 2 PR 1: schema + RLS + cron
-- ===========================================================================
--
-- Implements the design in `docs/proposals/document-request-system.md`
-- (merged via PR #151). This is the single migration covering:
--
--   • Drop-and-reset: deletes the one test row in volunteer_documents +
--     its storage object (production state per OQ-2 investigation: 1 row
--     from 2026-04-06, confirmed test data, no forward-migration burden)
--   • New ENUMs: document_request_state, document_rejection_reason
--   • document_types: add request_validity_days; seed 6 canonical types;
--     drop the admin-write RLS policy (freezing it to seed-managed)
--   • volunteer_documents: add request_id (FK), file_hash, mime_type,
--     rejection_reason_code, rejection_reason_detail; relax status CHECK
--     constraint to include under_review and expiring_soon; add rejection
--     consistency CHECK
--   • New tables: document_requests, document_acknowledgments
--   • New trigger functions: set_document_request_expiry (BEFORE INSERT
--     populates expires_at from request_validity_days),
--     enforce_document_request_state_machine (BEFORE UPDATE: immutable
--     columns, terminal-state guard, legal forward transitions, monotonic
--     extension_count)
--   • New view: volunteer_document_status (security_invoker = true,
--     coordinator-safe column projection — no storage_path / file_name /
--     rejection reasons)
--   • RLS rewrite: tighten coordinator access on volunteer_documents to
--     status-only org-wide (per OQ-2 resolution); admin-only storage
--     SELECT; storage DELETE narrowed to status='rejected'; volunteer
--     INSERT request-gated on both table and storage
--   • New RPCs: extend_document_request (admin extension with WHERE-clause
--     preconditions), submit_document (atomic upload finalization),
--     gdpr_erase_document (status-flip path that bypasses the
--     rejected-only storage DELETE policy)
--   • Cron extension: warn_expiring_documents() gets Step 0 (pending
--     request expiry, CTE form per §6 implementation note). Steps 1-2
--     byte-identical to baseline. The proposal-specified Step 3
--     (orphan-storage janitor) is OMITTED here because Supabase blocks
--     direct `DELETE FROM storage.objects` at the SQL layer; an Edge-
--     Function-based janitor is a separate architectural concern
--     tracked at #155.
--   • Comments documenting design choices (text+CHECK over ENUM for
--     volunteer_documents.status; cron schedule timezone tracked
--     separately)
--
-- Why volunteer_documents.status stays text+CHECK rather than becoming
-- a PG ENUM: the column already exists as text in production with
-- active queries, an existing CHECK, and TypeScript types generated
-- from the schema. Migrating to ENUM would require renaming the
-- column (or ALTER COLUMN ... TYPE with USING clauses), regenerating
-- types, updating every queryside .eq("status", "...") call, and
-- producing user-visible string changes if any literal differed. The
-- CHECK relaxation costs zero of those. ENUM gives marginally better
-- catalog-level documentation; not worth the migration churn.
--
-- Cron schedule note: the warn-expiring-documents-daily pg_cron job
-- is anchored to 13:00 UTC (not 13:00 Central). The function's
-- notification text formats dates in 'America/Chicago'. This means
-- notifications fire at 7-8 AM Central, not 1 PM Central. Pre-existing
-- latent issue, not introduced by this PR. Tracked separately as a
-- timezone-correction follow-up. PR 1 only `CREATE OR REPLACE` the
-- function body; the schedule is untouched.
--
-- Rollback: forward-corrective runbook at
-- docs/migration-history/20260426234610_document_request_system_rollback.md
-- (per OPERATIONS_RUNBOOK.md policy — no DOWN migration files).
-- ===========================================================================

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Drop-and-reset existing test data
-- ───────────────────────────────────────────────────────────────────────────
-- Note: storage object cleanup is NOT part of this SQL migration.
-- Supabase enforces "operations on storage.objects must go through the
-- Storage API" — direct `DELETE FROM storage.objects` raises
-- `Direct deletion from storage tables is not allowed. Use the Storage
-- API instead. (SQLSTATE 42501)`. The deploy operator removes the
-- pre-existing test object via the Storage API or dashboard before
-- applying this migration. See PR description's pre-merge checklist
-- for the operator step.
--
-- We DO delete the volunteer_documents rows here. Any storage object
-- without a matching row becomes an orphan that the operator's
-- pre-deploy cleanup, or the future orphan-janitor follow-up
-- (tracked at #155), removes.
DELETE FROM public.volunteer_documents;

-- We do NOT delete document_types here. The seed below upserts
-- canonical types via ON CONFLICT (name); old admin-created types
-- remain orphaned but harmless (nothing references them post-reset),
-- and removing them later is a separate cleanup if anyone cares.

-- ───────────────────────────────────────────────────────────────────────────
-- 2. New ENUMs
-- ───────────────────────────────────────────────────────────────────────────
CREATE TYPE public.document_request_state AS ENUM (
  'pending',     -- request created, awaiting volunteer upload
  'submitted',   -- volunteer uploaded, awaiting admin review
  'approved',    -- admin approved
  'rejected',    -- admin rejected, request closed
  'expired',     -- pending request hit expires_at without upload
  'cancelled'    -- admin cancelled before fulfillment
);

CREATE TYPE public.document_rejection_reason AS ENUM (
  'wrong_document_type',
  'unreadable',
  'contains_prohibited_information',
  'document_expired_or_outdated',
  'other'
);

-- ───────────────────────────────────────────────────────────────────────────
-- 3. document_types modifications + seed
-- ───────────────────────────────────────────────────────────────────────────
-- created_by is already nullable in production (see migration
-- 20260423000002_profile_fk_cascade_audit.sql). The proposal's §9 OQ-1
-- resolved to NULL for seed rows. No NOT-NULL drop needed here.

ALTER TABLE public.document_types
  ADD COLUMN IF NOT EXISTS request_validity_days integer NOT NULL DEFAULT 14;

-- Unique index on name so the seed below can ON CONFLICT (name).
-- Existing rows with duplicate names (if any) will fail this index;
-- production has no duplicates per the live DB inspection.
CREATE UNIQUE INDEX IF NOT EXISTS document_types_name_unique
  ON public.document_types (name);

INSERT INTO public.document_types
  (name, description, is_required, has_expiry, expiry_days, request_validity_days, is_active, created_by)
VALUES
  ('Background Check',                  'Iowa DCI/DPS background check report',         true,  true,  730, 30, true, NULL),
  ('Signed Code of Conduct',            'Acknowledged volunteer code of conduct',       true,  false, NULL, 14, true, NULL),
  ('Signed Confidentiality Agreement',  'Signed PHI / participant confidentiality',     true,  false, NULL, 14, true, NULL),
  ('Orientation Certificate',           'Completion of new-volunteer orientation',      true,  false, NULL, 14, true, NULL),
  ('CPR Training Certification',        'Current CPR certification card',               false, true,  730, 14, true, NULL),
  ('First Aid Certification',           'Current first aid certification card',         false, true,  730, 14, true, NULL)
ON CONFLICT (name) DO UPDATE SET
  description           = EXCLUDED.description,
  is_required           = EXCLUDED.is_required,
  has_expiry            = EXCLUDED.has_expiry,
  expiry_days           = EXCLUDED.expiry_days,
  request_validity_days = EXCLUDED.request_validity_days,
  is_active             = true,
  updated_at            = now();

-- Freeze document_types: drop the admin-write policy. Future type
-- changes only via service-role migrations.
DROP POLICY IF EXISTS "Admins manage document types" ON public.document_types;
-- Existing "Authenticated users read active document types" policy preserved.

-- ───────────────────────────────────────────────────────────────────────────
-- 4. document_requests + trigger
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE public.document_requests (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  volunteer_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  requested_by_admin_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  document_type_id         uuid NOT NULL REFERENCES public.document_types(id) ON DELETE RESTRICT,

  state                    public.document_request_state NOT NULL DEFAULT 'pending',

  -- Computed at INSERT by trg_document_requests_set_expiry.
  expires_at               timestamptz NOT NULL,

  -- Admin extension support. Cap at 2 (per design decision).
  extension_count          smallint NOT NULL DEFAULT 0
                           CHECK (extension_count BETWEEN 0 AND 2),
  last_extended_at         timestamptz,
  last_extended_by         uuid REFERENCES public.profiles(id),

  -- Cancellation bookkeeping.
  cancelled_at             timestamptz,
  cancelled_by             uuid REFERENCES public.profiles(id),
  cancel_reason            text,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX document_requests_volunteer_state_idx
  ON public.document_requests(volunteer_id, state);

-- Partial index for the cron Step 0 scan (pending → expired).
CREATE INDEX document_requests_pending_expiry_idx
  ON public.document_requests(expires_at) WHERE state = 'pending';

-- Trigger: populate expires_at from document_types.request_validity_days.
CREATE OR REPLACE FUNCTION public.set_document_request_expiry()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_days integer;
BEGIN
  SELECT request_validity_days INTO v_days
    FROM public.document_types WHERE id = NEW.document_type_id;
  NEW.expires_at := NEW.created_at + (COALESCE(v_days, 14) || ' days')::interval;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_document_requests_set_expiry
  BEFORE INSERT ON public.document_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_document_request_expiry();

-- State-machine trigger: enforce immutability + legal transitions on UPDATE.
CREATE OR REPLACE FUNCTION public.enforce_document_request_state_machine()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Immutable columns. Admin cannot retroactively edit who issued a
  -- request, which volunteer it was for, which type, or when it was
  -- created. Cancellations and approvals are state changes, not
  -- metadata edits.
  IF NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.requested_by_admin_id IS DISTINCT FROM OLD.requested_by_admin_id
     OR NEW.document_type_id IS DISTINCT FROM OLD.document_type_id
     OR NEW.volunteer_id IS DISTINCT FROM OLD.volunteer_id
  THEN
    RAISE EXCEPTION 'document_requests: cannot edit immutable columns';
  END IF;

  -- Terminal states are terminal.
  IF OLD.state IN ('approved', 'rejected', 'expired', 'cancelled')
     AND NEW.state IS DISTINCT FROM OLD.state
  THEN
    RAISE EXCEPTION 'document_requests: cannot transition out of terminal state %', OLD.state;
  END IF;

  -- Legal transitions from 'pending':
  --   pending → submitted (via submit_document RPC, volunteer-driven)
  --   pending → cancelled (admin)
  --   pending → expired   (cron Step 0)
  --   pending → pending   (extension)
  IF OLD.state = 'pending'
     AND NEW.state NOT IN ('pending', 'submitted', 'cancelled', 'expired')
  THEN
    RAISE EXCEPTION 'document_requests: illegal transition from pending → %', NEW.state;
  END IF;

  -- Legal transitions from 'submitted':
  --   submitted → approved (admin)
  --   submitted → rejected (admin)
  IF OLD.state = 'submitted'
     AND NEW.state NOT IN ('submitted', 'approved', 'rejected')
  THEN
    RAISE EXCEPTION 'document_requests: illegal transition from submitted → %', NEW.state;
  END IF;

  -- Extension count is monotonic. Column CHECK enforces ≤ 2; this
  -- additionally blocks decrement.
  IF NEW.extension_count < OLD.extension_count THEN
    RAISE EXCEPTION 'document_requests: extension_count is monotonic';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_document_requests_state_machine
  BEFORE UPDATE ON public.document_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_document_request_state_machine();

-- ───────────────────────────────────────────────────────────────────────────
-- 5. document_acknowledgments
-- ───────────────────────────────────────────────────────────────────────────
-- Append-only compliance evidence. UNIQUE on document_id enforces
-- one acknowledgment per document. INSERTed in same transaction as
-- the volunteer_documents row via submit_document RPC (the document
-- INSERT must precede the acknowledgment INSERT — FK dependency).
CREATE TABLE public.document_acknowledgments (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id                     uuid NOT NULL UNIQUE
                                    REFERENCES public.volunteer_documents(id) ON DELETE CASCADE,
  volunteer_id                    uuid NOT NULL
                                    REFERENCES public.profiles(id) ON DELETE CASCADE,
  acknowledgment_text_version     text NOT NULL,
  acknowledgment_text             text NOT NULL,
  acknowledged_at                 timestamptz NOT NULL DEFAULT now(),
  ip_address                      inet,
  user_agent                      text
);

CREATE INDEX document_acknowledgments_volunteer_idx
  ON public.document_acknowledgments(volunteer_id);

-- ───────────────────────────────────────────────────────────────────────────
-- 6. volunteer_documents modifications
-- ───────────────────────────────────────────────────────────────────────────
-- request_id NOT NULL because drop-and-reset above means there are no
-- orphan rows to grandfather.
ALTER TABLE public.volunteer_documents
  ADD COLUMN request_id              uuid NOT NULL
                                     REFERENCES public.document_requests(id) ON DELETE RESTRICT,
  ADD COLUMN file_hash               text,
  ADD COLUMN mime_type               text,
  ADD COLUMN rejection_reason_code   public.document_rejection_reason,
  ADD COLUMN rejection_reason_detail text;

-- One document per request.
CREATE UNIQUE INDEX volunteer_documents_request_id_unique
  ON public.volunteer_documents(request_id);

-- Relax the status CHECK to include the states the existing cron
-- writes ('expiring_soon') and the new under_review state. Resolves
-- #150 if the constraint omission was the root cause.
ALTER TABLE public.volunteer_documents
  DROP CONSTRAINT IF EXISTS volunteer_documents_status_check;
ALTER TABLE public.volunteer_documents
  ADD CONSTRAINT volunteer_documents_status_check
  CHECK (status = ANY (ARRAY[
    'pending_review',  -- legacy alias kept (no rename of existing column data)
    'under_review',
    'approved',
    'rejected',
    'expiring_soon',
    'expired'
  ]));

-- Sanity: rejection columns are set together.
ALTER TABLE public.volunteer_documents
  ADD CONSTRAINT volunteer_documents_rejection_consistency
  CHECK (
    (status <> 'rejected' AND rejection_reason_code IS NULL) OR
    (status = 'rejected' AND rejection_reason_code IS NOT NULL)
  );

-- ───────────────────────────────────────────────────────────────────────────
-- 7. Coordinator-safe view
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.volunteer_document_status AS
SELECT
  vd.id                                              AS document_id,
  vd.volunteer_id,
  vd.document_type_id,
  dt.name                                            AS document_type_name,
  vd.status,
  vd.expires_at                                      AS document_expires_at,
  vd.uploaded_at,
  -- Deliberately OMITTED:
  --   storage_path  (file location)
  --   file_name, file_hash, mime_type, file_size  (file content/identity)
  --   review_note  (admin free-text review comment)
  --   rejection_reason_code, rejection_reason_detail  (categorical reason + detail)
  --   reviewed_by, reviewed_at  (who reviewed, when — admin-internal)
  CASE WHEN vd.status = 'rejected' THEN true ELSE false END AS is_rejected
FROM public.volunteer_documents vd
JOIN public.document_types dt ON dt.id = vd.document_type_id
WHERE vd.status IN ('approved', 'expiring_soon', 'expired');
-- Filter: coordinators NEVER see under_review or rejected documents.

ALTER VIEW public.volunteer_document_status SET (security_invoker = true);

-- ───────────────────────────────────────────────────────────────────────────
-- 8. RLS policies (table)
-- ───────────────────────────────────────────────────────────────────────────
-- Enable RLS on new tables. Existing tables (volunteer_documents,
-- document_types) already have RLS enabled.
ALTER TABLE public.document_requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_acknowledgments ENABLE ROW LEVEL SECURITY;

-- ── document_requests ──
CREATE POLICY "Admins create document requests"
  ON public.document_requests FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins update document requests"
  ON public.document_requests FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
-- The admin UPDATE policy alone is too permissive — admin could
-- resurrect cancelled requests, edit immutables, etc. The
-- enforce_document_request_state_machine BEFORE UPDATE trigger
-- (defined above) is the actual gate; the policy delegates to it.

CREATE POLICY "Volunteers read own document requests"
  ON public.document_requests FOR SELECT TO authenticated
  USING (volunteer_id = auth.uid());

CREATE POLICY "Coordinators read all document requests"
  ON public.document_requests FOR SELECT TO authenticated
  USING (public.is_coordinator_or_admin());
-- Coordinator scope is org-wide per OQ-2 resolution. Coordinators
-- need compliance status BEFORE deciding to invite a volunteer; no
-- volunteer-departments association table exists. The view's column
-- redaction is the load-bearing PHI defense; row-scope expansion
-- doesn't weaken it. Tracked at #152 for tightening if a formal
-- volunteer↔department association is later introduced.
-- No DELETE policy → audit trail.

-- ── volunteer_documents ──
-- DROP existing policies being tightened or replaced.
DROP POLICY IF EXISTS "Coordinators and admins read all documents" ON public.volunteer_documents;
DROP POLICY IF EXISTS "Volunteers delete own pending documents"    ON public.volunteer_documents;
DROP POLICY IF EXISTS "Volunteers upload own documents"            ON public.volunteer_documents;

-- Volunteer INSERT requires an active pending request.
CREATE POLICY "Volunteers upload against active requests only"
  ON public.volunteer_documents FOR INSERT TO authenticated
  WITH CHECK (
    volunteer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.document_requests dr
      WHERE dr.id = volunteer_documents.request_id
        AND dr.volunteer_id = auth.uid()
        AND dr.state = 'pending'
        AND dr.expires_at > now()
    )
  );

-- Coordinators get row-level SELECT on the underlying table for
-- approved/expiring_soon/expired only. The view's projection is what
-- redacts file paths; this policy is what filters which rows.
CREATE POLICY "Coordinators read document status org-wide"
  ON public.volunteer_documents FOR SELECT TO authenticated
  USING (
    public.is_coordinator_or_admin()
    AND status IN ('approved', 'expiring_soon', 'expired')
  );

-- Admin SELECT (full row, including storage_path for review).
CREATE POLICY "Admins read all documents"
  ON public.volunteer_documents FOR SELECT TO authenticated
  USING (public.is_admin());

-- Admin DELETE narrowed to status='rejected'. GDPR-style erasure of
-- approved documents must use gdpr_erase_document RPC (defined below)
-- which flips status to rejected first.
CREATE POLICY "Admins delete documents on rejection"
  ON public.volunteer_documents FOR DELETE TO authenticated
  USING (public.is_admin() AND status = 'rejected');

-- Existing "Admins update documents" policy preserved (already exists
-- in baseline.sql). Existing "Volunteers read own documents" preserved.

-- ── document_acknowledgments ──
-- Append-only evidence — no UPDATE, no DELETE policies for any role.
CREATE POLICY "Volunteers create own acknowledgments"
  ON public.document_acknowledgments FOR INSERT TO authenticated
  WITH CHECK (volunteer_id = auth.uid());

CREATE POLICY "Volunteers read own acknowledgments"
  ON public.document_acknowledgments FOR SELECT TO authenticated
  USING (volunteer_id = auth.uid());

CREATE POLICY "Admins read all acknowledgments"
  ON public.document_acknowledgments FOR SELECT TO authenticated
  USING (public.is_admin());

-- ───────────────────────────────────────────────────────────────────────────
-- 9. RLS policies (storage bucket)
-- ───────────────────────────────────────────────────────────────────────────
-- DROP existing storage policies being tightened or replaced.
DROP POLICY IF EXISTS "Coordinators and admins read all docs from storage" ON storage.objects;
DROP POLICY IF EXISTS "Volunteers delete own docs from storage"            ON storage.objects;
DROP POLICY IF EXISTS "Volunteers upload own docs to storage"              ON storage.objects;

-- Volunteer INSERT: path-prefix-scoped + active-pending-request gated.
CREATE POLICY "Volunteers upload to storage against active requests"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'volunteer-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.document_requests dr
      WHERE dr.volunteer_id = auth.uid()
        AND dr.state = 'pending'
        AND dr.expires_at > now()
    )
  );

-- Admin-only SELECT (no coordinator equivalent — coordinators access
-- compliance status via the volunteer_document_status view, never the
-- raw file).
CREATE POLICY "Admins read all docs from storage"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'volunteer-documents'
    AND public.is_admin()
  );

-- Admin DELETE narrowed to objects whose row is already rejected.
-- GDPR erasure uses gdpr_erase_document RPC to flip status first.
CREATE POLICY "Admins delete rejected docs from storage"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'volunteer-documents'
    AND public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.volunteer_documents vd
      WHERE vd.storage_path = storage.objects.name
        AND vd.status = 'rejected'
    )
  );

-- Existing "Volunteers read own docs from storage" preserved.

-- ───────────────────────────────────────────────────────────────────────────
-- 10. RPCs
-- ───────────────────────────────────────────────────────────────────────────
-- 10a. extend_document_request — admin extension with WHERE-clause
-- preconditions (state=pending, within 7-day window of expires_at,
-- count < 2). UI button visibility uses the same predicates; the RPC's
-- WHERE clause is the actual gate. The state-machine trigger from §4
-- additionally catches "no resurrection from terminal states."
CREATE OR REPLACE FUNCTION public.extend_document_request(p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'extend_document_request: admin only';
  END IF;

  UPDATE public.document_requests dr
  SET extension_count   = dr.extension_count + 1,
      expires_at        = dr.expires_at + (
                            (SELECT request_validity_days FROM public.document_types
                             WHERE id = dr.document_type_id) || ' days'
                          )::interval,
      last_extended_at  = now(),
      last_extended_by  = auth.uid()
  WHERE dr.id = p_request_id
    AND dr.state = 'pending'
    AND dr.expires_at - now() <= INTERVAL '7 days'
    AND dr.extension_count < 2;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'extend_document_request: preconditions not met '
      '(state must be pending, within 7 days of expiry, extension_count < 2)';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.extend_document_request(uuid) TO authenticated;

-- 10b. submit_document — atomic upload finalization. Client uploads
-- file via storage SDK first (RLS-gated by the active-pending-request
-- check above), then calls this RPC, which in one transaction:
--   (1) verifies request is still in pending state
--   (2) INSERTs volunteer_documents (status=under_review)
--   (3) INSERTs document_acknowledgments
--   (4) UPDATEs document_requests.state to submitted
-- If any step fails, transaction rolls back. Any orphaned storage
-- object is cleaned up by the cron Step 3 janitor (see §11).
CREATE OR REPLACE FUNCTION public.submit_document(
  p_request_id              uuid,
  p_storage_path            text,
  p_file_name               text,
  p_file_type               text,
  p_file_size               integer,
  p_mime_type               text,
  p_file_hash               text,
  p_ack_text_version        text,
  p_ack_text                text,
  p_ip_address              inet DEFAULT NULL,
  p_user_agent              text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
DECLARE
  v_volunteer_id      uuid;
  v_document_type_id  uuid;
  v_document_id       uuid;
BEGIN
  -- Verify caller owns the request and it's in pending state.
  SELECT volunteer_id, document_type_id INTO v_volunteer_id, v_document_type_id
  FROM public.document_requests
  WHERE id = p_request_id
    AND state = 'pending'
    AND expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'submit_document: request not found or not in pending state';
  END IF;

  IF v_volunteer_id <> auth.uid() THEN
    RAISE EXCEPTION 'submit_document: only the requested volunteer can submit';
  END IF;

  -- (2) volunteer_documents row — must come before acknowledgment
  -- because the acknowledgment FK references it.
  INSERT INTO public.volunteer_documents
    (volunteer_id, document_type_id, request_id, file_name, file_type,
     file_size, storage_path, mime_type, file_hash, status)
  VALUES
    (v_volunteer_id, v_document_type_id, p_request_id, p_file_name,
     p_file_type, p_file_size, p_storage_path, p_mime_type, p_file_hash,
     'under_review')
  RETURNING id INTO v_document_id;

  -- (3) acknowledgment row.
  INSERT INTO public.document_acknowledgments
    (document_id, volunteer_id, acknowledgment_text_version,
     acknowledgment_text, ip_address, user_agent)
  VALUES
    (v_document_id, v_volunteer_id, p_ack_text_version,
     p_ack_text, p_ip_address, p_user_agent);

  -- (4) flip request state.
  UPDATE public.document_requests
  SET state = 'submitted'
  WHERE id = p_request_id;

  RETURN v_document_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_document(
  uuid, text, text, text, integer, text, text, text, text, inet, text
) TO authenticated;

-- 10c. gdpr_erase_document — admin-only path that flips status to
-- 'rejected' first so the storage DELETE policy permits removal.
-- Sets rejection_reason_code='other' and detail='gdpr_erasure' for
-- audit. The actual storage DELETE is a separate call by the admin
-- after this RPC succeeds.
CREATE OR REPLACE FUNCTION public.gdpr_erase_document(p_document_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'gdpr_erase_document: admin only';
  END IF;

  UPDATE public.volunteer_documents
  SET status                  = 'rejected',
      rejection_reason_code   = 'other',
      rejection_reason_detail = 'gdpr_erasure',
      reviewed_by             = auth.uid(),
      reviewed_at             = now()
  WHERE id = p_document_id
    AND status <> 'rejected';
  -- Note: not requiring NOT FOUND check here. Idempotent — re-running
  -- on an already-rejected row is a no-op, which is the safe choice.
END;
$$;

GRANT EXECUTE ON FUNCTION public.gdpr_erase_document(uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 11. Cron extension — warn_expiring_documents() 3-step body
-- ───────────────────────────────────────────────────────────────────────────
-- Step 0 (NEW): Expire pending document_requests past expires_at.
-- Step 1: existing — mark approved docs expiring within 30 days as
--         'expiring_soon' + send warning notifications.
-- Step 2: existing — mark expired docs as 'expired' + notify.
--
-- Note on the orphan-storage janitor: the proposal §6 originally
-- specified a Step 3 that deletes orphan storage objects via
-- `DELETE FROM storage.objects`. Supabase blocks that pattern at the
-- SQL layer (`Direct deletion from storage tables is not allowed.
-- Use the Storage API instead.`) — same constraint that prevented
-- the migration's drop-and-reset from cleaning the existing test
-- object. An orphan janitor needs an Edge Function or pg_net HTTP
-- call to the Storage API. That's a separate architectural concern
-- tracked at #155. Step 3 is omitted from this migration; orphans
-- accumulate harmlessly until that janitor lands.
--
-- Audit log asymmetry: Step 0 logs to admin_action_log because an
-- unfulfilled admin request is a workflow event. Steps 1 and 2 don't
-- log — they're predictable from data already on the row, and the
-- existing function never logged them.
CREATE OR REPLACE FUNCTION public.warn_expiring_documents()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec record;
BEGIN
  -- ── Step 0 (NEW): Expire pending requests past their expires_at ──
  -- CTE form per §6 implementation note (cleaner than separate
  -- audit/notify/update queries with the same predicate).
  WITH to_expire AS (
    SELECT
      dr.id,
      dr.volunteer_id,
      dr.document_type_id,
      dr.requested_by_admin_id,
      dr.expires_at,
      dr.extension_count,
      dt.name AS document_type_name,
      p.full_name AS volunteer_full_name
    FROM public.document_requests dr
    JOIN public.document_types dt ON dt.id = dr.document_type_id
    LEFT JOIN public.profiles p ON p.id = dr.volunteer_id
    WHERE dr.state = 'pending' AND dr.expires_at < now()
  ),
  audit_inserts AS (
    INSERT INTO public.admin_action_log (admin_id, volunteer_id, action, payload)
    SELECT
      te.requested_by_admin_id,
      te.volunteer_id,
      'document_request.expired_unfulfilled',
      jsonb_build_object(
        'request_id',       te.id,
        'document_type_id', te.document_type_id,
        'document_type',    te.document_type_name,
        'expires_at',       te.expires_at,
        'extension_count',  te.extension_count
      )
    FROM to_expire te
    RETURNING admin_id
  ),
  notify_admin AS (
    INSERT INTO public.notifications (user_id, type, title, message, link, is_read, data)
    SELECT
      te.requested_by_admin_id,
      'document_request_expired_unfulfilled',
      'Document request expired: ' || te.document_type_name,
      'The document request for ' || COALESCE(te.volunteer_full_name, 'a volunteer') ||
        ' (' || te.document_type_name || ') expired on ' ||
        to_char(te.expires_at AT TIME ZONE 'America/Chicago', 'Mon DD, YYYY') ||
        ' without an upload. Re-issue the request if it''s still needed.',
      '/admin/documents/review',
      false,
      jsonb_build_object(
        'request_id',      te.id,
        'volunteer_id',    te.volunteer_id,
        'document_type',   te.document_type_name,
        'expires_at',      te.expires_at,
        'extension_count', te.extension_count
      )
    FROM to_expire te
    RETURNING user_id
  )
  UPDATE public.document_requests dr
  SET state = 'expired'
  FROM to_expire te
  WHERE dr.id = te.id;

  -- ── Step 1: Mark approved docs expiring within 30 days (UNCHANGED) ──
  FOR rec IN
    UPDATE volunteer_documents
    SET status = 'expiring_soon', updated_at = now()
    WHERE status = 'approved'
      AND expires_at IS NOT NULL
      AND expires_at <= now() + interval '30 days'
      AND expires_at > now()
    RETURNING id, volunteer_id, document_type_id, expires_at
  LOOP
    INSERT INTO notifications (user_id, type, title, message, link, is_read, data)
    SELECT
      rec.volunteer_id,
      'document_expiry_warning',
      'Document expiring soon: ' || dt.name,
      'Your "' || dt.name || '" document expires on ' ||
        to_char(rec.expires_at AT TIME ZONE 'America/Chicago', 'Mon DD, YYYY') ||
        ' (' || EXTRACT(DAY FROM (rec.expires_at - now()))::int || ' days remaining). ' ||
        'Please upload a renewed copy before it expires.',
      '/documents',
      false,
      jsonb_build_object(
        'document_id',    rec.id,
        'document_type',  dt.name,
        'expires_at',     rec.expires_at,
        'days_remaining', EXTRACT(DAY FROM (rec.expires_at - now()))::int
      )
    FROM document_types dt
    WHERE dt.id = rec.document_type_id
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.user_id = rec.volunteer_id
          AND n.type = 'document_expiry_warning'
          AND (n.data->>'document_id')::uuid = rec.id
          AND n.created_at > now() - interval '7 days'
      );
  END LOOP;

  -- ── Step 2: Mark expired docs (UNCHANGED) ──
  FOR rec IN
    UPDATE volunteer_documents
    SET status = 'expired', updated_at = now()
    WHERE status IN ('approved', 'expiring_soon')
      AND expires_at IS NOT NULL
      AND expires_at < now()
    RETURNING id, volunteer_id, document_type_id, expires_at
  LOOP
    INSERT INTO notifications (user_id, type, title, message, link, is_read, data)
    SELECT
      rec.volunteer_id,
      'document_expired',
      'Document expired: ' || dt.name,
      'Your "' || dt.name || '" document expired on ' ||
        to_char(rec.expires_at AT TIME ZONE 'America/Chicago', 'Mon DD, YYYY') ||
        '. Please upload a renewed copy to maintain your eligibility.',
      '/documents',
      false,
      jsonb_build_object(
        'document_id',   rec.id,
        'document_type', dt.name,
        'expires_at',    rec.expires_at
      )
    FROM document_types dt
    WHERE dt.id = rec.document_type_id
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.user_id = rec.volunteer_id
          AND n.type = 'document_expired'
          AND (n.data->>'document_id')::uuid = rec.id
      );
  END LOOP;

  -- Step 3 (orphan-storage janitor) intentionally omitted — see comment
  -- block at the top of this section. Tracked at #155.
END;
$$;

COMMIT;
