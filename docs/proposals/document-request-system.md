# Document Request & Upload System — Phase 1 Proposal

_Draft — 2026-04-26 (revised post-review) — feature branch `feature/document-request-system-proposal`_
_Resolves Phase 1 of the broader feature work; Phase 2 (build) gated on review of this doc._
_Revision incorporates review of comments on PR #151: §3 coordinator scope changed to org-wide (OQ-2 resolved as Option C), admin UPDATE policy tightened via state-machine trigger, storage DELETE narrowed to rejected rows only, §4 transactional pattern revised, §7 phrasing fix, §9 OQ-1 fallback to nullable, test-count and pre-deploy-checklist additions._

---

## 0. Executive summary

The volunteer scheduler already has a working document upload system: `volunteer_documents` table, `document_types` lookup, `volunteer-documents` storage bucket, 860 lines of UI across `VolunteerDocuments.tsx` / `AdminDocumentTypes.tsx` / `DocumentCompliance.tsx`, and a daily expiry cron (`warn_expiring_documents()`). It is volunteer-push (volunteers upload unsolicited against any active document type), and document types are admin-configurable.

This proposal **integrates** a request-driven, admin-pull workflow on top of that infrastructure (Path B from the escalation report). It preserves working RLS, working storage, working notification wiring, and the existing cron pass; it adds two new tables (`document_requests`, `document_acknowledgments`) and tightens existing RLS policies; it freezes `document_types` to a seed-managed list of 6 canonical types and retires the admin type-management UI.

Production state at proposal time: 1 row in `volunteer_documents` from 2026-04-06, confirmed test data. Migration is **drop-and-reset** — no forward-migration of existing data.

The three design decisions that most need confirmation before Phase 2 begins are listed at the end of this document and will be repeated in the PR description.

---

## 1. Existing infrastructure — what we keep, what we modify, what we retire

### 1.1 Tables already in production

**`document_types`** (baseline.sql:3188–3199)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `name` | text NOT NULL | |
| `description` | text | |
| `is_required` | bool NOT NULL DEFAULT false | |
| `has_expiry` | bool NOT NULL DEFAULT false | |
| `expiry_days` | integer | Document content expiry (e.g. 365 for a CPR card) |
| `is_active` | bool NOT NULL DEFAULT true | |
| `created_by` | uuid NOT NULL | |
| `created_at`, `updated_at` | timestamptz | |

**`volunteer_documents`** (baseline.sql:3553–3569)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `volunteer_id` | uuid NOT NULL | |
| `document_type_id` | uuid NOT NULL FK → document_types | |
| `file_name`, `file_type`, `file_size`, `storage_path` | text/int | |
| `status` | text NOT NULL DEFAULT 'pending_review' | CHECK ∈ {pending_review, approved, rejected, expired} |
| `reviewed_by`, `reviewed_at`, `review_note` | nullable | Admin review |
| `expires_at` | timestamptz | Document content expiry |
| `uploaded_at`, `updated_at` | timestamptz | |

**Storage bucket `volunteer-documents`** with parallel RLS — coordinators currently CAN read files (will tighten).

### 1.2 Cron job

`warn_expiring_documents()` runs daily at 1 PM. Per issue #121's decision (close 2026-04-26), the merged design — both warning step and expiry step in one pass — is the intended state. We extend it here with a third step (expire pending requests past their `expires_at`) rather than splitting into multiple functions or schedules.

### 1.3 Existing UI (860 lines total)

| File | Lines | Disposition under this proposal |
|---|---|---|
| `src/pages/VolunteerDocuments.tsx` | 290 | **Rewire.** "All active types with upload buttons" → "My active requests + history". Major behavior change but file remains. |
| `src/pages/AdminDocumentTypes.tsx` | 230 | **Retire (delete).** Per modification on the Path B decision. |
| `src/pages/DocumentCompliance.tsx` | 340 | **Keep, refine.** Already an admin compliance dashboard; gets the new request states + per-type validity columns. |

### 1.4 Issue #150 (separate)

`warn_expiring_documents()` writes `status = 'expiring_soon'` but the baseline CHECK constraint omits that value. Tracked in #150; not blocking. The new schema in §2 explicitly relaxes the CHECK constraint to include `'expiring_soon'`, which incidentally resolves #150 if its root cause is "constraint never relaxed."

---

## 2. Schema

### 2.1 New: PostgreSQL ENUM types

```sql
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
```

`document_review_state` (the per-document review status — `under_review`, `approved`, `rejected`, `expiring_soon`, `expired`) is implemented by **relaxing the existing `volunteer_documents.status` CHECK constraint** to add `'under_review'` and `'expiring_soon'`. Reuses the existing column rather than introducing a parallel enum.

> **Why text+CHECK instead of a PG ENUM here:** the column already exists as text in production with active queries against it, an existing CHECK constraint, and TypeScript types generated from the schema. Migrating to ENUM would require renaming the column (or doing the `ALTER COLUMN ... TYPE` dance with USING clauses), regenerating types, updating every queryside .eq("status", "...") call, and producing user-visible string changes if any literal differed. The CHECK relaxation costs zero of those. ENUM gives marginally better catalog-level documentation; not worth the migration churn.

### 2.2 Modify: `document_types`

```sql
-- New column for per-type request validity window.
ALTER TABLE public.document_types
  ADD COLUMN request_validity_days integer NOT NULL DEFAULT 14;

-- Seed the 6 canonical types. Run AFTER the drop-and-reset (see §8.1) so
-- there are no FK orphans from old rows.
INSERT INTO public.document_types
  (name, description, is_required, has_expiry, expiry_days, request_validity_days, is_active, created_by)
VALUES
  ('Background Check',                  'Iowa DCI/DPS background check report',         true,  true,  730, 30, true, '00000000-0000-0000-0000-000000000000'),
  ('Signed Code of Conduct',            'Acknowledged volunteer code of conduct',       true,  false, NULL, 14, true, '00000000-0000-0000-0000-000000000000'),
  ('Signed Confidentiality Agreement',  'Signed PHI / participant confidentiality',     true,  false, NULL, 14, true, '00000000-0000-0000-0000-000000000000'),
  ('Orientation Certificate',           'Completion of new-volunteer orientation',      true,  false, NULL, 14, true, '00000000-0000-0000-0000-000000000000'),
  ('CPR Training Certification',        'Current CPR certification card',               false, true,  730, 14, true, '00000000-0000-0000-0000-000000000000'),
  ('First Aid Certification',           'Current first aid certification card',         false, true,  730, 14, true, '00000000-0000-0000-0000-000000000000');
```

`created_by` zero-uuid is a sentinel for "system-seeded, not user-created"; the column stays NOT NULL to avoid migration churn. (Open question OQ-1 in §9.)

### 2.3 Modify: `volunteer_documents`

```sql
-- Tie every upload to a parent request. NOT NULL because drop-and-reset
-- means there are no orphan rows to grandfather.
ALTER TABLE public.volunteer_documents
  ADD COLUMN request_id uuid NOT NULL REFERENCES public.document_requests(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX volunteer_documents_request_id_unique
  ON public.volunteer_documents(request_id);
-- One document per request — the design constraint from the brief.

-- Relax the CHECK constraint to include the states the existing cron
-- writes ('expiring_soon') and the new under-review state. Resolves #150
-- if the constraint was the root cause.
ALTER TABLE public.volunteer_documents
  DROP CONSTRAINT IF EXISTS volunteer_documents_status_check;
ALTER TABLE public.volunteer_documents
  ADD CONSTRAINT volunteer_documents_status_check
  CHECK (status = ANY (ARRAY[
    'pending_review',  -- legacy alias kept to avoid renaming during migration
    'under_review',    -- new: aligns with submitted state
    'approved',
    'rejected',
    'expiring_soon',   -- written by warn_expiring_documents() Step 1
    'expired'
  ]));

-- New columns for evidence integrity + audit.
ALTER TABLE public.volunteer_documents
  ADD COLUMN file_hash       text,         -- sha256 hex; NOT NULL for new rows (see §8.1)
  ADD COLUMN mime_type       text,         -- normalized MIME (separate from existing file_type)
  ADD COLUMN rejection_reason_code   public.document_rejection_reason,
  ADD COLUMN rejection_reason_detail text;

-- Sanity: rejection columns should be set together.
ALTER TABLE public.volunteer_documents
  ADD CONSTRAINT volunteer_documents_rejection_consistency
  CHECK (
    (status <> 'rejected' AND rejection_reason_code IS NULL) OR
    (status = 'rejected' AND rejection_reason_code IS NOT NULL)
  );
```

The existing `expires_at` column **keeps its meaning**: the document content's expiry date (set by admin at approval). The new request expiry uses a different column on `document_requests` — see §2.4. This avoids an awkward rename.

### 2.4 New: `document_requests`

```sql
CREATE TABLE public.document_requests (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  volunteer_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  requested_by_admin_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  document_type_id         uuid NOT NULL REFERENCES public.document_types(id) ON DELETE RESTRICT,

  state                    public.document_request_state NOT NULL DEFAULT 'pending',

  -- Computed at INSERT (see trigger below). Pending requests auto-expire here.
  expires_at               timestamptz NOT NULL,

  -- Admin extension support. Cap at 2 extensions (§ design decision).
  extension_count          smallint NOT NULL DEFAULT 0
                           CHECK (extension_count BETWEEN 0 AND 2),
  last_extended_at         timestamptz,
  last_extended_by         uuid REFERENCES public.profiles(id),

  -- Lifecycle bookkeeping.
  cancelled_at             timestamptz,
  cancelled_by             uuid REFERENCES public.profiles(id),
  cancel_reason            text,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX document_requests_volunteer_state_idx
  ON public.document_requests(volunteer_id, state);
CREATE INDEX document_requests_pending_expiry_idx
  ON public.document_requests(expires_at) WHERE state = 'pending';
-- Targeted partial index for the cron job that scans pending → expired.

-- Trigger: compute expires_at from document_types.request_validity_days at insert.
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
```

### 2.5 New: `document_acknowledgments`

```sql
CREATE TABLE public.document_acknowledgments (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id                     uuid NOT NULL UNIQUE REFERENCES public.volunteer_documents(id) ON DELETE CASCADE,
  volunteer_id                    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  acknowledgment_text_version     text NOT NULL,        -- e.g. 'v1.0'
  acknowledgment_text             text NOT NULL,        -- full verbatim text shown at upload
  acknowledged_at                 timestamptz NOT NULL DEFAULT now(),

  ip_address                      inet,
  user_agent                      text
);

CREATE INDEX document_acknowledgments_volunteer_idx
  ON public.document_acknowledgments(volunteer_id);
```

`UNIQUE` on `document_id` enforces one acknowledgment per uploaded document. The acknowledgment row is INSERTED in the same transaction as the `volunteer_documents` row — see §4 state-machine side-effects.

> **Transactional ordering inside `submit_document(...)` RPC:** the volunteer_documents INSERT must precede the document_acknowledgments INSERT within the function body, because document_acknowledgments.document_id has a NOT NULL UNIQUE FK to volunteer_documents.id. Both rows then commit together. The submit_document RPC body and any test fixtures must reflect this order.

### 2.6 New view: `volunteer_document_status` (coordinator-safe)

```sql
CREATE OR REPLACE VIEW public.volunteer_document_status AS
SELECT
  vd.id                                        AS document_id,
  vd.volunteer_id,
  vd.document_type_id,
  dt.name                                      AS document_type_name,
  vd.status,
  vd.expires_at                                AS document_expires_at,
  vd.uploaded_at,
  -- NO storage_path, file_name, file_hash, mime_type, file_size,
  -- NO rejection_reason_code or rejection_reason_detail,
  -- NO review_note.
  CASE WHEN vd.status = 'rejected' THEN true ELSE false END AS is_rejected
FROM public.volunteer_documents vd
JOIN public.document_types dt ON dt.id = vd.document_type_id
WHERE vd.status IN ('approved', 'expiring_soon', 'expired');
-- Coordinators see ONLY approved / expiring_soon / expired, never under_review or rejected.
```

This is the access surface for the coordinator-facing compliance badge. RLS on this view delegates to the underlying tables; we add a permissive SELECT policy on the view for coordinators-and-admins because the projection itself is what enforces redaction.

---

## 3. RLS policies

### 3.1 `document_types` — switch to seed-managed

```sql
-- DROP the existing admin-write policy.
DROP POLICY IF EXISTS "Admins manage document types" ON public.document_types;

-- READ stays open to authenticated users for active types.
-- (existing policy "Authenticated users read active document types" preserved)

-- No INSERT/UPDATE/DELETE policy means RLS denies them outright.
-- Type changes can only happen via service-role migrations going forward.
```

The existing read policy is preserved exactly. Removing the write policy is the entire defense — service-role migrations bypass RLS, so seeded changes still work.

### 3.2 `document_requests`

```sql
-- INSERT: admins only.
CREATE POLICY "Admins create document requests"
  ON public.document_requests FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- UPDATE: admins only (state transitions, extensions, cancellation).
CREATE POLICY "Admins update document requests"
  ON public.document_requests FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
-- The policy alone is too permissive — admin could resurrect cancelled
-- requests, edit created_at, etc. State-machine enforcement is layered on
-- top via a BEFORE UPDATE trigger:

CREATE OR REPLACE FUNCTION public.enforce_document_request_state_machine()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Immutable columns: created_at, requested_by_admin_id, document_type_id,
  -- volunteer_id. (Admin cannot retroactively edit who issued the request,
  -- which volunteer it was for, or which type. Cancellations and approvals
  -- are state changes, not metadata changes.)
  IF NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.requested_by_admin_id IS DISTINCT FROM OLD.requested_by_admin_id
     OR NEW.document_type_id IS DISTINCT FROM OLD.document_type_id
     OR NEW.volunteer_id IS DISTINCT FROM OLD.volunteer_id
  THEN
    RAISE EXCEPTION 'document_requests: cannot edit immutable columns';
  END IF;

  -- Terminal states are terminal. Once approved, rejected, expired, or
  -- cancelled, no further state changes permitted.
  IF OLD.state IN ('approved', 'rejected', 'expired', 'cancelled')
     AND NEW.state IS DISTINCT FROM OLD.state
  THEN
    RAISE EXCEPTION 'document_requests: cannot transition out of terminal state %', OLD.state;
  END IF;

  -- Legal forward transitions from 'pending':
  --   pending → submitted (volunteer-side via submit_document RPC)
  --   pending → cancelled (admin)
  --   pending → expired   (cron)
  --   pending → pending   (extension)
  IF OLD.state = 'pending'
     AND NEW.state NOT IN ('pending', 'submitted', 'cancelled', 'expired')
  THEN
    RAISE EXCEPTION 'document_requests: illegal transition from pending → %', NEW.state;
  END IF;

  -- Legal forward transitions from 'submitted':
  --   submitted → approved (admin)
  --   submitted → rejected (admin)
  IF OLD.state = 'submitted'
     AND NEW.state NOT IN ('submitted', 'approved', 'rejected')
  THEN
    RAISE EXCEPTION 'document_requests: illegal transition from submitted → %', NEW.state;
  END IF;

  -- Extension cap is enforced by the column CHECK; this trigger
  -- additionally guards against decrementing extension_count.
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
-- This trigger enforces the state machine at the DB level — defense even
-- if a future code path bypasses the RPC. The RPC remains the canonical
-- entry point but the trigger catches mistakes.

-- SELECT: volunteer sees own; coordinators see requests for volunteers in
-- their assigned departments (status only — they can't see the document
-- file via this row); admins see all.
CREATE POLICY "Volunteers read own document requests"
  ON public.document_requests FOR SELECT TO authenticated
  USING (volunteer_id = auth.uid());

CREATE POLICY "Coordinators read all document requests"
  ON public.document_requests FOR SELECT TO authenticated
  USING (public.is_coordinator_or_admin());

-- DELETE: never. Audit trail.
-- (No DELETE policy = RLS denies.)
```

**Coordinator row scope is org-wide.** The booking-scoped variant in earlier drafts of this proposal was rejected on review (OQ-2): coordinators need compliance status BEFORE deciding to invite a volunteer, but bookings and invitations both come AFTER that decision. No `volunteer_departments` association table exists in the schema, so there is no association we can scope to that captures the pre-assignment moment. The view's column redaction (no `storage_path`, no rejection reasons, no `under_review` rows) is the load-bearing PHI defense; row-scope expansion does not weaken it. The existing `InviteVolunteerModal` already reads `profiles.bg_check_status` org-wide for the same reason. See §9 OQ-2 for the full reasoning and the follow-up issue tracking eventual scope tightening if a `volunteer_departments` table is later introduced.

### 3.3 `volunteer_documents` — tighten existing

```sql
-- DROP the existing coordinator full-row read.
DROP POLICY IF EXISTS "Coordinators and admins read all documents"
  ON public.volunteer_documents;

-- DROP the existing volunteer-self-delete policy. Volunteers no longer
-- delete their own documents — admins delete on rejection.
DROP POLICY IF EXISTS "Volunteers delete own pending documents"
  ON public.volunteer_documents;

-- Modify the volunteer INSERT policy to require an active pending request.
DROP POLICY IF EXISTS "Volunteers upload own documents" ON public.volunteer_documents;
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

-- New: admin SELECT/DELETE. (UPDATE policy already exists.)
CREATE POLICY "Admins read all documents"
  ON public.volunteer_documents FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins delete documents on rejection"
  ON public.volunteer_documents FOR DELETE TO authenticated
  USING (public.is_admin() AND status = 'rejected');
-- Narrowed per review: admin can only DELETE rows that have already been
-- marked rejected. GDPR-style erasure of approved documents requires a
-- separate code path that flips status first via a dedicated RPC. This
-- prevents accidental hot-delete of an approved document from the admin
-- UI shortcutting the state machine.

-- Existing "Volunteers read own documents" preserved.

-- Coordinators DO NOT get a SELECT policy on this table. They access
-- volunteer_document_status (the view) instead.
```

### 3.4 `volunteer_document_status` view

```sql
ALTER VIEW public.volunteer_document_status SET (security_invoker = true);
-- The view enforces RLS via the underlying tables. Coordinators get a view
-- SELECT policy that's broader than what they'd have on the raw table,
-- because the view's projection already redacts file paths.

CREATE POLICY "Coordinators read document status org-wide"
  ON public.volunteer_documents FOR SELECT TO authenticated
  USING (
    public.is_coordinator_or_admin()
    AND status IN ('approved', 'expiring_soon', 'expired')
  );
-- Coordinator row scope is org-wide (see §3.2 rationale). The status filter
-- limits coordinators to terminal-positive document states only — they
-- never see under_review or rejected rows, even via the raw table. The
-- view's projection (§2.6) is what redacts the file_path/file_name/
-- rejection-reason columns. Two-layer defense: row filter via policy,
-- column filter via view projection.
```

### 3.5 `document_acknowledgments`

```sql
CREATE POLICY "Volunteers create own acknowledgments"
  ON public.document_acknowledgments FOR INSERT TO authenticated
  WITH CHECK (volunteer_id = auth.uid());

CREATE POLICY "Volunteers read own acknowledgments"
  ON public.document_acknowledgments FOR SELECT TO authenticated
  USING (volunteer_id = auth.uid());

CREATE POLICY "Admins read all acknowledgments"
  ON public.document_acknowledgments FOR SELECT TO authenticated
  USING (public.is_admin());

-- No UPDATE, no DELETE. Acknowledgments are append-only evidence.
```

### 3.6 Storage bucket `volunteer-documents` — tighten existing

```sql
-- DROP coordinator file-content access.
DROP POLICY IF EXISTS "Coordinators and admins read all docs from storage"
  ON storage.objects;

-- Replace with admins-only.
CREATE POLICY "Admins read all docs from storage"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'volunteer-documents'
    AND public.is_admin()
  );

-- DROP volunteer self-delete (admin owns deletion now).
DROP POLICY IF EXISTS "Volunteers delete own docs from storage"
  ON storage.objects;

-- Admin deletion narrowed to objects whose row in volunteer_documents is
-- already marked rejected. GDPR-style erasure of approved documents uses
-- a separate code path that flips status to 'rejected' first via a
-- dedicated RPC (sets rejection_reason_code='other', detail='gdpr_erasure'
-- or similar). Prevents accidental hot-delete of approved documents.
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

-- Keep volunteer upload + own-read policies. But tighten upload to
-- require a pending request (parallel to §3.3).
DROP POLICY IF EXISTS "Volunteers upload own docs to storage" ON storage.objects;
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
-- The path-prefix check ensures volunteers can only write under their
-- own folder. The EXISTS clause requires an active pending request.
```

---

## 4. State machine

### 4.1 Request states (`document_requests.state`)

| From | To | Trigger | Actor | Side effects | Audit log |
|---|---|---|---|---|---|
| _none_ | `pending` | Admin creates request | admin | Trigger sets `expires_at`; notification → volunteer ("Document requested"); email | `admin_action_log`: `document_request.created` |
| `pending` | `pending` (extended) | Admin extends | admin | `extension_count++`; `expires_at += request_validity_days`; `last_extended_at/by` set; notification → volunteer ("More time granted") | `admin_action_log`: `document_request.extended` |
| `pending` | `submitted` | Volunteer uploads + acknowledges | volunteer | `volunteer_documents` row INSERT (status=`under_review`); `document_acknowledgments` row INSERT; notification → admins ("Document under review") | `admin_action_log`: `document_request.submitted` |
| `pending` | `expired` | Cron: `now() >= expires_at` AND state=`pending` | system | Notification → admin ("Request expired without upload") | `admin_action_log`: `document_request.expired_unfulfilled` |
| `pending` | `cancelled` | Admin cancels | admin | `cancelled_at/by/reason` set; notification → volunteer ("Request cancelled") | `admin_action_log`: `document_request.cancelled` |
| `submitted` | `approved` | Admin approves + sets `volunteer_documents.expires_at` (document content expiry) | admin | `volunteer_documents.status` → `approved`; `reviewed_at/by`; notification → volunteer ("Document approved") | `admin_action_log`: `document_request.approved` |
| `submitted` | `rejected` | Admin rejects with `rejection_reason_code` (+ `_detail` if `other`) | admin | `volunteer_documents.status` → `rejected`; storage object DELETED; notification → volunteer ("Document rejected, contact admin") with NO reason | `admin_action_log`: `document_request.rejected` (records reason for admin audit) |

Once a request reaches `approved`, `rejected`, `expired`, or `cancelled`, it is terminal — no further transitions. Re-issuing requires a new request row.

### 4.2 Document states (`volunteer_documents.status`)

These states are downstream of an `approved` request; the request itself stays in `approved`.

| From | To | Trigger | Actor | Side effects |
|---|---|---|---|---|
| `under_review` | `approved` | Admin approves | admin | (matches §4.1 row) |
| `under_review` | `rejected` | Admin rejects | admin | (matches §4.1 row) |
| `approved` | `expiring_soon` | Cron: `now() >= expires_at - 30 days` | system | Notification → admin ("Document expiring soon: {name}, {n} days") — already exists, kept verbatim |
| `approved`, `expiring_soon` | `expired` | Cron: `now() >= expires_at` | system | Notification → admin + volunteer ("Document expired") — already exists |

`expired` is terminal at the document level. Refresh requires a fresh request → upload → acknowledgment cycle.

### 4.3 Side-effect transactionality

Three places need atomicity:

- **Submit:** revised pattern per review. The client first uploads the file via the storage SDK (which RLS gates on the active pending request — §3.6). Once the upload succeeds, the client calls `submit_document(request_id, storage_path, file_hash, mime_type, file_size, file_name, ack_text_version, ack_text, ip_address, user_agent)` — a single RPC that, in one transaction, (1) verifies the storage object exists at `storage_path` via service-role storage query, (2) INSERTs `volunteer_documents` (status=`under_review`), (3) INSERTs `document_acknowledgments`, (4) UPDATEs `document_requests.state` to `submitted`. If any step fails, the transaction rolls back and the storage object is orphaned. The orphan window is the latency between upload-success and rpc-failure — small but non-zero. **Janitor:** the `warn_expiring_documents()` cron gets an additional Step 3 that deletes storage objects in the `volunteer-documents` bucket whose `name` does not match any `volunteer_documents.storage_path`. Runs daily; bounded orphan lifetime ≤ 24 hours.
- **Reject:** `document_requests.state = 'rejected'` + `volunteer_documents.status = 'rejected'` + storage DELETE. The DB transaction (request UPDATE + document UPDATE + setting `rejection_reason_code`/`_detail`) commits first. The storage DELETE is then issued via service-role; success/failure is independent. If DELETE fails, the row is already correctly `rejected`, and an admin alert fires (`notification` "Storage cleanup failed for document {id}"). The row's `rejected` state is what the storage RLS policy now requires for any subsequent admin DELETE — so even a manual retry from the admin UI will succeed once the row state catches up.
- **Approve:** request UPDATE + document UPDATE — single transaction. No storage operation.

### 4.4 Server-side enforcement of extension constraints

The "extend pending request" affordance is an admin RPC (`extend_document_request(request_id)`), not a direct UPDATE. Both the UI (button visibility) and the RPC (precondition guard) enforce the constraints — the RPC body MUST include:

```sql
-- Inside extend_document_request(p_request_id uuid):
UPDATE public.document_requests
SET extension_count   = extension_count + 1,
    expires_at        = expires_at + (
                          (SELECT request_validity_days FROM public.document_types
                           WHERE id = document_requests.document_type_id) || ' days'
                        )::interval,
    last_extended_at  = now(),
    last_extended_by  = auth.uid()
WHERE id = p_request_id
  AND state = 'pending'
  AND expires_at - now() <= INTERVAL '7 days'   -- must be in the visibility window
  AND extension_count < 2;                       -- cap

IF NOT FOUND THEN
  RAISE EXCEPTION 'extension preconditions not met (state=pending, within 7 days of expiry, count<2)';
END IF;
```

If the UI is bypassed (admin hits the RPC directly via the SDK or psql), the RPC's WHERE-clause precondition is the actual gate. The state-machine trigger from §3.2 also catches the broader "no resurrection from terminal states" case.

---

## 5. UI surfaces

### 5.1 Admin

| Surface | Route | Components | R/W ops |
|---|---|---|---|
| Request a document | `AdminUsers` → volunteer detail panel adds "Request document" button | `RequestDocumentDialog` (new) — dropdown of 6 types, optional message-to-volunteer | INSERT `document_requests` |
| Pending review queue | New route `/admin/documents/review` | `AdminPendingReviewList` (new) — paginated list of `submitted` documents across all volunteers | SELECT `document_requests` JOIN `volunteer_documents` WHERE state=`submitted` |
| Approve / reject screen | Click-through from queue: `/admin/documents/review/:requestId` | `DocumentReviewScreen` (new) — file preview (signed URL), approve form (set `expires_at`), reject form (categorical reason + optional detail) | UPDATE both tables; storage DELETE on reject |
| Volunteer document history | Existing `DocumentCompliance.tsx` extended | New columns: request state, request `expires_at`, extension count | SELECT |
| Extend a pending request | Inline button on `DocumentCompliance` rows where state=`pending` AND `expires_at - now() <= 7 days` AND `extension_count < 2` | `ExtendRequestButton` (new, inline) | UPDATE `document_requests` |
| Cancel a pending request | Inline button on `DocumentCompliance` rows where state=`pending` | Inline confirmation modal | UPDATE `document_requests` |

### 5.2 Volunteer

| Surface | Route | Components | R/W ops |
|---|---|---|---|
| My active requests + history | `/documents` (existing `VolunteerDocuments.tsx`, **rewired**) | `MyActiveRequestsList` (new), `MyDocumentHistoryList` (new). The current "all upload buttons" UI is removed. | SELECT `document_requests` (own); SELECT `volunteer_documents` (own) |
| Upload | Click-through from active request: `/documents/upload/:requestId` | `DocumentUploadForm` (new) with `AcknowledgmentGate` (new — checkbox + verbatim text panel; submit button disabled until checked) | Calls RPC `submit_document(...)` |
| Rejection display | Inline on history list | Shows "Rejected" + "Contact admin for details" — verbatim. NO `rejection_reason_code` or `_detail` rendered. | — |

### 5.3 Coordinator

| Surface | Route | Components | R/W ops |
|---|---|---|---|
| Department volunteer compliance | New tab on `DepartmentManagement` page (or section in `coordinator/DepartmentVolunteersTab.tsx`) | `VolunteerComplianceBadgeList` (new) — per-volunteer compliance summary | SELECT `volunteer_document_status` view |

The badge shows: `{document_type_name}: {status}{, expires {date} if approved/expiring_soon}`. Coordinators **never see file content, file paths, rejection reasons, or under_review documents**. They see exactly what the view exposes — that's the access boundary, not a UI affordance to be undone.

### 5.4 Retired

`AdminDocumentTypes.tsx` (230 lines) — deleted. Remove the route, remove the sidebar entry. No replacement.

---

## 6. Cron / scheduled jobs

### 6.1 Recommendation: extend `warn_expiring_documents()` rather than add new functions

Per issue #121's decision (close 2026-04-26), the merged-function design is the intended state. We follow that pattern: the existing 1-PM-daily function gets a Step 0 prepended, becoming a 3-step pass.

```sql
CREATE OR REPLACE FUNCTION public.warn_expiring_documents()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
DECLARE
  rec record;
BEGIN
  -- ── Step 0 (NEW): Expire pending requests past their expires_at ──
  UPDATE public.document_requests
  SET state = 'expired', updated_at = now()
  WHERE state = 'pending' AND expires_at < now();

  -- (Notify admin per expired pending request.)
  -- ...

  -- ── Step 1: Mark approved documents expiring within 30 days (existing) ──
  -- (unchanged)

  -- ── Step 2: Mark expired documents (existing) ──
  -- (unchanged)
END;
$$;
```

Single function, single cron, single audit trail. Renaming to `process_document_lifecycle()` is **not** part of this PR — that's the same separate-rename concern noted in issue #121, deferred to a future cleanup if anyone cares.

> **Audit log asymmetry — Step 0 logs, Steps 1/2 don't.** Step 0 transitions a request that someone (the originating admin) needs to know about — an unfulfilled request is a workflow event. Steps 1/2 transition documents along their natural aging timeline; the next state is fully predictable from `expires_at` and the current clock. Comment in the function body explains this so a future reader doesn't add logging to Steps 1/2 thinking it was an oversight.

> **Cron schedule timezone.** The notification text uses `'America/Chicago'` for human-readable date formatting. The pg_cron schedule entry must match — either be defined in `'America/Chicago'` (preferred, DST-aware) or correctly converted to UTC at schedule-creation time. Confirm at PR 1 implementation: `SELECT * FROM cron.job WHERE jobname = 'warn-expiring-documents-daily'` and check the `schedule` and `timezone` (if present) columns. If the schedule is in UTC without a timezone column, the 1 PM Central window drifts ±1 hour across DST; document the chosen approach in the migration.

> **Step 3 (NEW): orphan-storage janitor.** Per the §4 transactional pattern revision, a fourth step is added to delete orphaned storage objects (uploaded by a volunteer but never linked to a `volunteer_documents` row, e.g. because the `submit_document` RPC failed post-upload). Step 3 deletes objects in the `volunteer-documents` bucket whose `name` does not appear in any `volunteer_documents.storage_path`. Runs daily; orphan lifetime ≤ 24 hours.

### 6.2 Alternative considered: separate jobs

Three separate functions on three separate schedules (e.g. 6 AM, 1 PM, 11 PM) would let each step be reasoned about independently. Rejected because (a) operational surface triples, (b) the existing decision in #121 explicitly favored the merged design, (c) all three steps are cheap reads + small UPDATEs and don't compete for resources.

---

## 7. Acknowledgment text v1.0

Stored verbatim in `document_acknowledgments.acknowledgment_text` and tagged `v1.0` in `acknowledgment_text_version`. The component (`AcknowledgmentGate`) renders this text from a `const ACK_TEXT_V1_0` exported from a new `src/lib/document-acknowledgment.ts` file, single source of truth.

```
Before you upload, please confirm:

I am uploading the document that was specifically requested. I have
checked that this file does NOT contain any of the following:

  • Vaccination records or immunization history
  • Test results, lab results, or screening outcomes (medical, drug,
    or otherwise)
  • Diagnoses or descriptions of medical conditions
  • Prescription information or medication lists
  • Fitness-for-duty letters or accommodation requests
  • Any other personal health information beyond what was requested

If I am unsure whether something in this document qualifies, I will
contact the administrator before uploading.

I understand that:

  • If the administrator determines a document contains prohibited
    information, it will be deleted from this system and the request
    will be closed. The administrator may require me to re-submit a
    corrected document.
  • Repeated violations may result in suspension of my volunteer
    account.
  • This acknowledgment is recorded with the date, my account, my IP
    address, and the version of this text I agreed to. It will be
    retained as compliance evidence.

By checking the box below, I confirm I have read this notice and the
document I am about to upload contains only the information that was
requested.
```

Word count: ~190. Reads in ~30 seconds at typical reading speed. Names the prohibited categories explicitly (vaccination, lab results, diagnoses, prescriptions, fitness-for-duty). States consequence (deletion + possible suspension). States the evidence retained.

Open question OQ-3: Should this be reviewed by Easterseals legal counsel before launch? My recommendation: yes, but not blocking Phase 1 — get legal review in parallel with Phase 2's build, before PR 3 ships.

---

## 8. Migration plan

### 8.0 PR 1 test count and pre-merge checklist

Test count revised per review. PR 1 includes RLS smoke tests + state-machine trigger tests + the trigger-populated `expires_at` check, all run via `supabase db psql --linked` against a local branch. Realistic count: **8–12 tests**.

| # | Test | Asserts |
|---|---|---|
| 1 | Coordinator querying `volunteer_document_status` for an under_review document | Returns zero rows (status filter) |
| 2 | Coordinator querying `volunteer_document_status` for a rejected document | Returns zero rows (status filter) |
| 3 | Coordinator `createSignedUrl` on a valid `storage_path` | Storage RLS denies (no SELECT policy for coordinator) |
| 4 | Volunteer INSERT into `volunteer_documents` without an active pending request | Policy denies |
| 5 | Volunteer INSERT into `volunteer_documents` with active pending request | Succeeds |
| 6 | Admin INSERT into `document_requests` | Trigger populates `expires_at = created_at + request_validity_days` |
| 7 | `extension_count = 3` UPDATE | CHECK constraint violation |
| 8 | UPDATE `document_requests.state = 'pending'` from `cancelled` | State-machine trigger raises |
| 9 | UPDATE `document_requests.created_at` (any value) | State-machine trigger raises (immutable) |
| 10 | Admin DELETE on a `volunteer_documents` row with status='approved' | RLS denies (only rejected rows deletable) |
| 11 | Storage DELETE on object whose row status='approved' | Storage RLS denies |
| 12 | Happy path: admin creates request → volunteer uploads → admin approves | All transitions succeed |

### 8.0.1 PR 1 pre-merge deploy checklist

These are reviewer requirements, not after-the-fact docs:

- [ ] `pg_dump` of `document_types` and `volunteer_documents` taken before deploy; archived to `pre-migration-backups/<deploy-date>/` (or wherever the team archives such artifacts)
- [ ] Storage bucket export of `volunteer-documents/` taken before deploy; archived alongside the SQL dump
- [ ] UP migration run against a non-production branch (Supabase project copy or local `supabase db reset` + apply)
- [ ] Test data seeded post-UP: at least one `document_requests` row in each of `pending`, `approved`, `rejected`, `expired`, `cancelled` states; one `document_acknowledgments` row; one `volunteer_documents` row in each of `under_review`, `approved`, `expiring_soon`, `expired`
- [ ] DOWN migration run against the same non-production branch
- [ ] Schema diff between original baseline and post-DOWN confirms full revert (no orphan policies, no orphan columns, no orphan ENUMs)
- [ ] Backup archives committed to the deploy-runbook repo or equivalent durable location
- [ ] Cron timezone confirmed (see §6 note)

### 8.1 PR 1 — Schema, RLS, drop-and-reset, AdminDocumentTypes retirement

Single migration file. Order matters; the storage cleanup must read `storage_path` values **before** the `volunteer_documents` rows are deleted.

```sql
-- supabase/migrations/<timestamp>_document_request_system.sql

BEGIN;

-- ── 1. Drop-and-reset existing test data ──
-- Capture storage paths before deleting rows.
CREATE TEMP TABLE _orphan_storage_paths AS
SELECT storage_path FROM public.volunteer_documents;

-- Delete storage objects matching captured paths. (storage.objects is in
-- the storage schema; service-role can write to it from a migration.)
DELETE FROM storage.objects
WHERE bucket_id = 'volunteer-documents'
  AND name IN (SELECT storage_path FROM _orphan_storage_paths);

-- Now safe to delete rows.
DELETE FROM public.volunteer_documents;
-- We do NOT delete document_types here — the seed below upserts canonical
-- types. Old admin-created types remain orphaned but harmless: nothing
-- references them after the rows above are gone, and removing them later
-- (as a separate cleanup) is fine.

DROP TABLE _orphan_storage_paths;

-- ── 2. ENUMs ──
CREATE TYPE public.document_request_state AS ENUM (...);
CREATE TYPE public.document_rejection_reason AS ENUM (...);

-- ── 3. document_types: add column, seed, drop admin-write policy ──
ALTER TABLE public.document_types
  ADD COLUMN request_validity_days integer NOT NULL DEFAULT 14;
INSERT INTO public.document_types (...) ON CONFLICT (name) DO UPDATE SET ...;
DROP POLICY IF EXISTS "Admins manage document types" ON public.document_types;

-- ── 4. document_requests + trigger ──
CREATE TABLE public.document_requests (...);
CREATE INDEX ...;
CREATE FUNCTION public.set_document_request_expiry() ...;
CREATE TRIGGER ...;

-- ── 5. document_acknowledgments ──
CREATE TABLE public.document_acknowledgments (...);

-- ── 6. volunteer_documents modifications ──
ALTER TABLE public.volunteer_documents
  ADD COLUMN request_id uuid NOT NULL REFERENCES public.document_requests(id) ...;
-- (...all column additions and CHECK relaxation from §2.3)

-- ── 7. Coordinator-safe view ──
CREATE OR REPLACE VIEW public.volunteer_document_status AS ...;

-- ── 8. RLS policy changes ──
DROP POLICY IF EXISTS "Coordinators and admins read all documents" ...;
DROP POLICY IF EXISTS "Volunteers delete own pending documents" ...;
DROP POLICY IF EXISTS "Volunteers upload own documents" ...;
CREATE POLICY ...; -- all new policies from §3

-- ── 9. Storage RLS changes ──
DROP POLICY IF EXISTS "Coordinators and admins read all docs from storage" ...;
DROP POLICY IF EXISTS "Volunteers delete own docs from storage" ...;
DROP POLICY IF EXISTS "Volunteers upload own docs to storage" ...;
CREATE POLICY ...; -- all new storage policies from §3.6

-- ── 10. Cron function extension ──
CREATE OR REPLACE FUNCTION public.warn_expiring_documents() ...;
-- (Step 0 prepended; Steps 1 & 2 unchanged from baseline)

-- ── 11. RPC for atomic submit ──
CREATE OR REPLACE FUNCTION public.submit_document(...);
GRANT EXECUTE ON FUNCTION public.submit_document(...) TO authenticated;

COMMIT;
```

After PR 1 lands: the schema is in place, RLS denies all new functionality from the UI side (no UI yet to call any of it), and the existing `VolunteerDocuments.tsx` page is broken because (a) volunteer INSERT now requires a `request_id`, (b) the column is NOT NULL. **PR 1 must ship together with at least the read-only side of PR 2** so volunteers don't see a broken page in the meantime — see §8.6.

Also delete in PR 1:
- `src/pages/AdminDocumentTypes.tsx`
- The route entry in `App.tsx`
- The sidebar entry pointing to it
- Any tests referencing it (none expected — confirm in implementation)

### 8.2 PR 2 — Admin "request" + "review" UI + cron extension

- New `RequestDocumentDialog` mounted from `AdminUsers` volunteer detail
- New `/admin/documents/review` queue page
- New `DocumentReviewScreen` for approve/reject with file preview via signed URL
- Inline extend + cancel on `DocumentCompliance`
- The cron extension already shipped in PR 1 (it's a SQL change)

### 8.3 PR 3 — Volunteer upload UI with acknowledgment gate

- Rewire `VolunteerDocuments.tsx` to "active requests + history" model
- New `DocumentUploadForm`
- New `AcknowledgmentGate` with v1.0 text exported from `src/lib/document-acknowledgment.ts`
- Calls `submit_document` RPC

**Legal review of acknowledgment text v1.0 must complete before this PR ships** (OQ-3).

### 8.4 PR 4 — Coordinator read-only compliance view

- `VolunteerComplianceBadgeList` rendered in `DepartmentVolunteersTab`
- Reads from `volunteer_document_status` view only
- No file access, no rejection reasons

### 8.5 PR 5 — Document expiry handling + admin notifications

- The cron-side work is in PR 1 already (warn_expiring_documents extension)
- This PR adds the UI affordances: admin notification rendering for "request expired", "document expiring soon", "document expired"; a "Re-issue request" button on expired-document rows in `DocumentCompliance`
- Add Vitest coverage for `useDocumentRequests` hook (or whatever the data layer ends up being)
- Add Playwright coverage of the full request → upload → review → expire cycle

### 8.6 Sequencing constraint

Because PR 1 sets `volunteer_documents.request_id NOT NULL` and there is currently a working volunteer upload page, **PR 1 and PR 2 must land in the same release window** (or PR 1 includes a feature flag that disables the volunteer upload page until PR 3 lands). Concrete recommendation: PR 1 includes a temporary fallback render in `VolunteerDocuments.tsx` ("Document uploads are being upgraded — your administrator will request specific documents from you. Please contact admin@... if you need to submit a document urgently."). PR 3 replaces that fallback with the full new UI.

This avoids leaving the page broken between deploys.

---

## 9. Open questions

| ID | Question | My recommendation |
|---|---|---|
| **OQ-1** | `document_types.created_by` is NOT NULL, but seed-managed types have no real creator. Use a sentinel zero-uuid, or relax to nullable? | **Resolved (review): nullable.** Investigation found `document_types.created_by → profiles.id`, and `profiles.id → auth.users.id ON DELETE CASCADE`. A sentinel zero-uuid would fail the FK chain. Per the pre-approved fallback in the OQ-1 review response, the migration drops the NOT NULL constraint on `document_types.created_by` and seeded rows have `created_by = NULL`. |
| **OQ-2** | Coordinator visibility scope: booking-scoped, department-scoped (no formal table exists), or org-wide? | **Resolved (review): org-wide.** Investigation found no `volunteer_departments` association table; `shift_invitations` and `shift_bookings` both come AFTER the assignment decision and so cannot scope a "compliance-before-assignment" read. The view's column redaction (no `storage_path`, no rejection reasons, no `under_review` rows) is the load-bearing PHI defense; row-scope expansion does not weaken it. The existing `InviteVolunteerModal` already reads `profiles.bg_check_status` org-wide for the same reason — formalizing the policy here aligns with current production behavior. **Follow-up issue:** filed as #152 ("Tighten coordinator compliance read scope when a `volunteer_departments` association exists"); reference from PR 1's §3.2 migration comment. |
| **OQ-3** | Should acknowledgment text v1.0 go through Easterseals legal review before PR 3 ships? | Yes. Get legal review in parallel with PR 2's build so it doesn't block. |
| **OQ-4** | When a document hits `expired` (cron Step 2), should the system auto-create a fresh `pending` request for the same type? | No. Admin re-issues manually. Auto-issue would create a request the admin doesn't know about and may not still want; the workflow assumes deliberate admin initiation. |
| **OQ-5** | The 30-day BG-check `request_validity_days` was confirmed; the admin extension cap is 2 (so max effective request lifetime: 30 + 30 + 30 = 90 days). Is 90 days enough headroom for the worst-case BG check tail? | Almost certainly yes. The tail of the tail (90+ days) usually indicates the volunteer dropped off and a new request is the right answer anyway. |

---

## 10. The three design decisions to confirm before Phase 2

These are the choices most likely to require revisiting if wrong, and are repeated in the PR description:

### Decision 1 — Coordinator read access via a redacted view, not policy-only

The proposal builds a `volunteer_document_status` view that omits `storage_path`, `file_name`, `file_hash`, `mime_type`, `file_size`, `review_note`, `rejection_reason_code`, and `rejection_reason_detail`, then grants coordinators row-level SELECT on the underlying table for `approved`/`expiring_soon`/`expired` rows only. **Two-layer defense:** the policy gates which rows, the view's projection gates which columns. The alternative — column-level RLS via Postgres column-grants — is more brittle and harder to audit. Confirm the view-based approach.

### Decision 2 — Single migration file with drop-and-reset + RLS tightening + cron extension all in one

Per §8.1, PR 1 is a single migration that does everything: drops the test data, adds the new tables, freezes `document_types` write access, tightens existing storage and table RLS, and extends `warn_expiring_documents()`. This is a wide migration but it lands the entire schema-side change as one atomic state transition. The alternative — three separate migrations sequenced over a release cadence — would leave intermediate states where RLS is partially tightened and the new tables exist without the cron extension. Confirm the all-in-one approach.

### Decision 3 — PR 1 ships with a temporary fallback page, not behind a feature flag

§8.6 — `VolunteerDocuments.tsx` will be temporarily replaced with a "your administrator will request specific documents from you" placeholder when PR 1 deploys, then rewired to the full new UI in PR 3. The alternative is a feature flag that keeps the old upload page running until PR 3 lands. The fallback is simpler operationally (one less moving piece, no flag-cleanup PR) but makes the volunteer experience worse for the PR-1-to-PR-3 window. Confirm fallback-page approach, or call for a feature flag instead.
