# Document Request & Upload System — Phase 1 Proposal

_Draft — 2026-04-26 — feature branch `feature/document-request-system-proposal`_
_Resolves Phase 1 of the broader feature work; Phase 2 (build) gated on review of this doc._

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

-- SELECT: volunteer sees own; coordinators see requests for volunteers in
-- their assigned departments (status only — they can't see the document
-- file via this row); admins see all.
CREATE POLICY "Volunteers read own document requests"
  ON public.document_requests FOR SELECT TO authenticated
  USING (volunteer_id = auth.uid());

CREATE POLICY "Coordinators read department document requests"
  ON public.document_requests FOR SELECT TO authenticated
  USING (
    public.is_coordinator_or_admin()
    AND (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.department_coordinators dc
        JOIN public.shift_bookings sb ON sb.volunteer_id = document_requests.volunteer_id
        JOIN public.shifts s ON s.id = sb.shift_id
        WHERE dc.coordinator_id = auth.uid()
          AND dc.department_id = s.department_id
      )
    )
  );

-- DELETE: never. Audit trail.
-- (No DELETE policy = RLS denies.)
```

The coordinator policy is intentionally restrictive: a coordinator only sees a volunteer's requests if the volunteer has a booking in the coordinator's assigned department. Open question OQ-2 in §9 (alternative: any active volunteer in the department, regardless of booking).

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
  USING (public.is_admin());

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

CREATE POLICY "Coordinators read department document status"
  ON public.volunteer_documents FOR SELECT TO authenticated
  USING (
    public.is_coordinator_or_admin()
    AND status IN ('approved', 'expiring_soon', 'expired')
    AND EXISTS (
      SELECT 1 FROM public.department_coordinators dc
      JOIN public.shift_bookings sb ON sb.volunteer_id = volunteer_documents.volunteer_id
      JOIN public.shifts s ON s.id = sb.shift_id
      WHERE dc.coordinator_id = auth.uid()
        AND dc.department_id = s.department_id
    )
  );
-- This policy lets the view function for coordinators. The view's projection
-- is what redacts file_path/file_name/etc.; the policy gates which rows
-- they can see. Two-layer defense: row filter via policy, column filter via
-- view projection.
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

-- Admin deletion (used by rejection flow + manual cleanup).
CREATE POLICY "Admins delete docs from storage"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'volunteer-documents'
    AND public.is_admin()
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

- **Submit:** `volunteer_documents` INSERT + `document_acknowledgments` INSERT + `document_requests.state = 'submitted'` UPDATE — all in one transaction (server-side via an RPC `submit_document(request_id, file_metadata, ack_text_version, ack_text)`). If any step fails, the storage upload is the orphan; cleanup is best-effort via a periodic job (or accepted as noise).
- **Reject:** `document_requests.state = 'rejected'` + `volunteer_documents.status = 'rejected'` + storage DELETE. The storage delete is fire-and-forget after the DB transaction commits — if it fails, the row is already marked rejected, and an admin alert fires (notification: "Storage cleanup failed for document {id}").
- **Approve:** request UPDATE + document UPDATE — single transaction.

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

  • If a document I upload contains prohibited information, it will
    be deleted from this system. The administrator may close the
    request and require me to re-submit a corrected document.
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
| **OQ-1** | `document_types.created_by` is NOT NULL, but seed-managed types have no real creator. Use a sentinel zero-uuid (proposed), or relax to nullable? | Sentinel zero-uuid. Less migration churn, no semantic loss — `created_by = '00000000...'` reads as "system". |
| **OQ-2** | Coordinator visibility scope: only volunteers with bookings in their assigned departments (proposed), or any active volunteer in those departments (broader)? | Booking-scoped. Tighter PHI defense by default; admins can broaden later if it surfaces a real ergonomics gap. |
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
