# Document Request System — Corrective Rollback Runbook

_For migration `supabase/migrations/20260426234610_document_request_system.sql`_

## When to run this

Apply this corrective migration if any of:

- The UP migration partially failed mid-deploy and the schema is in an inconsistent state.
- A post-deploy regression in PRs 2–5 traces back to PR 1's schema changes (RLS misconfiguration, trigger logic error, etc.) and rolling forward with a fix is impractical.
- A security review identifies a defect in the RLS posture that needs immediate revert before a forward-fix can be drafted.

**Do NOT apply if `document_requests` or `document_acknowledgments` contain real production data** — see "Pre-conditions check" below.

This is the **forward-corrective** rollback per `docs/OPERATIONS_RUNBOOK.md` line 82 ("Postgres doesn't have a built-in rollback; you write a corrective forward migration"). It is not a DOWN migration.

## Pre-conditions check

Run BEFORE applying the rollback SQL. Each query must return the expected value.

```sql
SELECT count(*) FROM public.document_requests;
-- Expected: 0
-- (No real request data exists yet — PR 1 ships before PR 2 wires the
-- admin "request" UI, so any rows here are test data the on-call
-- engineer should export first.)

SELECT count(*) FROM public.document_acknowledgments;
-- Expected: 0

SELECT count(*) FROM public.volunteer_documents WHERE request_id IS NOT NULL;
-- Expected: 0
-- (Only volunteer_documents rows tied to a request would exist; PR 1
-- enforces NOT NULL on request_id, so any non-null request_id row
-- implies a request was created.)
```

If any of these is non-zero, **STOP**. Export the rows to a backup file before proceeding. The corrective SQL drops these tables and the data they contain is unrecoverable from the SQL alone.

## Corrective SQL

Wrapped in `BEGIN/COMMIT` for atomicity.

```sql
BEGIN;

-- ── 1. Restore baseline cron function body (Steps 1+2 only) ──
-- Source the body from supabase/migrations/20260101000000_baseline.sql
-- lines 2950-3030. Pasted inline here to avoid sourcing concerns.
CREATE OR REPLACE FUNCTION public.warn_expiring_documents()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec record;
BEGIN
  -- Step 1: Mark approved documents expiring within 30 days
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
        'document_id', rec.id,
        'document_type', dt.name,
        'expires_at', rec.expires_at,
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

  -- Step 2: Mark expired documents
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
        'document_id', rec.id,
        'document_type', dt.name,
        'expires_at', rec.expires_at
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
END;
$$;

-- ── 2. Drop new RPCs ──
DROP FUNCTION IF EXISTS public.gdpr_erase_document(uuid);
DROP FUNCTION IF EXISTS public.submit_document(uuid, text, text, text, integer, text, text, text, text, inet, text);
DROP FUNCTION IF EXISTS public.extend_document_request(uuid);

-- ── 3. Drop new RLS policies (storage) ──
DROP POLICY IF EXISTS "Volunteers upload to storage against active requests" ON storage.objects;
DROP POLICY IF EXISTS "Admins read all docs from storage"                   ON storage.objects;
DROP POLICY IF EXISTS "Admins delete rejected docs from storage"            ON storage.objects;

-- ── 4. Restore baseline storage policies ──
CREATE POLICY "Coordinators and admins read all docs from storage"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'volunteer-documents' AND public.is_coordinator_or_admin());

CREATE POLICY "Volunteers delete own docs from storage"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'volunteer-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Volunteers upload own docs to storage"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'volunteer-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── 5. Drop new RLS policies (tables) ──
DROP POLICY IF EXISTS "Admins create document requests"               ON public.document_requests;
DROP POLICY IF EXISTS "Admins update document requests"               ON public.document_requests;
DROP POLICY IF EXISTS "Volunteers read own document requests"         ON public.document_requests;
DROP POLICY IF EXISTS "Coordinators read all document requests"       ON public.document_requests;
DROP POLICY IF EXISTS "Volunteers create own acknowledgments"         ON public.document_acknowledgments;
DROP POLICY IF EXISTS "Volunteers read own acknowledgments"           ON public.document_acknowledgments;
DROP POLICY IF EXISTS "Admins read all acknowledgments"               ON public.document_acknowledgments;
DROP POLICY IF EXISTS "Volunteers upload against active requests only" ON public.volunteer_documents;
DROP POLICY IF EXISTS "Coordinators read document status org-wide"     ON public.volunteer_documents;
DROP POLICY IF EXISTS "Admins read all documents"                      ON public.volunteer_documents;
DROP POLICY IF EXISTS "Admins delete documents on rejection"           ON public.volunteer_documents;

-- ── 6. Restore baseline volunteer_documents policies ──
CREATE POLICY "Coordinators and admins read all documents"
  ON public.volunteer_documents FOR SELECT TO authenticated
  USING (public.is_coordinator_or_admin());

CREATE POLICY "Volunteers delete own pending documents"
  ON public.volunteer_documents FOR DELETE TO authenticated
  USING ((volunteer_id = auth.uid()) AND (status = 'pending_review'));

CREATE POLICY "Volunteers upload own documents"
  ON public.volunteer_documents FOR INSERT TO authenticated
  WITH CHECK (volunteer_id = auth.uid());

-- ── 7. Restore document_types admin-write policy ──
CREATE POLICY "Admins manage document types"
  ON public.document_types TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── 8. Drop view ──
DROP VIEW IF EXISTS public.volunteer_document_status;

-- ── 9. Drop tables (children first) ──
DROP TABLE IF EXISTS public.document_acknowledgments;
DROP TABLE IF EXISTS public.document_requests;

-- ── 10. Drop trigger functions ──
DROP FUNCTION IF EXISTS public.enforce_document_request_state_machine() CASCADE;
DROP FUNCTION IF EXISTS public.set_document_request_expiry() CASCADE;

-- ── 11. Migrate volunteer_documents.status rows that hold relaxed values ──
-- These values are not in the baseline CHECK; UPDATE before re-adding the
-- constraint or it will fail.
UPDATE public.volunteer_documents SET status = 'approved'        WHERE status = 'expiring_soon';
UPDATE public.volunteer_documents SET status = 'pending_review'  WHERE status = 'under_review';

-- ── 12. Drop volunteer_documents columns and constraints added by PR 1 ──
ALTER TABLE public.volunteer_documents
  DROP CONSTRAINT IF EXISTS volunteer_documents_rejection_consistency,
  DROP CONSTRAINT IF EXISTS volunteer_documents_status_check,
  DROP COLUMN IF EXISTS rejection_reason_detail,
  DROP COLUMN IF EXISTS rejection_reason_code,
  DROP COLUMN IF EXISTS mime_type,
  DROP COLUMN IF EXISTS file_hash,
  DROP COLUMN IF EXISTS request_id;

DROP INDEX IF EXISTS public.volunteer_documents_request_id_unique;

-- ── 13. Restore baseline volunteer_documents.status CHECK ──
ALTER TABLE public.volunteer_documents
  ADD CONSTRAINT volunteer_documents_status_check
  CHECK (status = ANY (ARRAY['pending_review', 'approved', 'rejected', 'expired']));

-- ── 14. Delete seeded document_types rows ──
DELETE FROM public.document_types
WHERE created_by IS NULL
  AND name IN (
    'Background Check', 'Signed Code of Conduct',
    'Signed Confidentiality Agreement', 'Orientation Certificate',
    'CPR Training Certification', 'First Aid Certification'
  );

DROP INDEX IF EXISTS public.document_types_name_unique;

-- ── 15. Drop request_validity_days column ──
ALTER TABLE public.document_types DROP COLUMN IF EXISTS request_validity_days;

-- ── 16. Drop new ENUM types ──
DROP TYPE IF EXISTS public.document_rejection_reason;
DROP TYPE IF EXISTS public.document_request_state;

COMMIT;
```

## Post-conditions check

Run AFTER applying the rollback SQL. Each must match baseline state.

```sql
\d+ public.document_types
-- Expected: matches baseline.sql:3188-3199 column set
-- (no request_validity_days column)

\d+ public.volunteer_documents
-- Expected: matches baseline.sql:3553-3569 column set
-- (no request_id, file_hash, mime_type, rejection_reason_*)
-- CHECK constraint allows {pending_review, approved, rejected, expired} only

SELECT count(*) FROM pg_class WHERE relname IN (
  'document_requests', 'document_acknowledgments',
  'volunteer_document_status'
);
-- Expected: 0

SELECT count(*) FROM pg_type WHERE typname IN (
  'document_request_state', 'document_rejection_reason'
);
-- Expected: 0

SELECT count(*) FROM cron.job WHERE jobname = 'warn-expiring-documents-daily';
-- Expected: 1 (still scheduled; only the function body changed)

SELECT pg_get_functiondef(oid) FROM pg_proc
WHERE proname = 'warn_expiring_documents';
-- Expected: matches baseline.sql:2950-3030 body (Steps 1 and 2 only,
-- no Step 0, no Step 3)

SELECT count(*) FROM pg_proc
WHERE proname IN (
  'set_document_request_expiry',
  'enforce_document_request_state_machine',
  'extend_document_request',
  'submit_document',
  'gdpr_erase_document'
);
-- Expected: 0
```

## Manual steps the SQL cannot automate

1. **AdminDocumentTypes.tsx restoration.** PR 1 deletes `src/pages/AdminDocumentTypes.tsx`, removes the route from `App.tsx`, and removes the sidebar entries from `AppSidebar.tsx` and `MobileNav.tsx`. To restore: `git revert <PR-1-merge-commit>` on the application side.

2. **VolunteerDocuments.tsx restoration.** PR 1 replaces the page body with the temporary fallback. Same `git revert` approach.

3. **Test row + storage object restore.** PR 1 deleted the single 2026-04-06 test row from `volunteer_documents` and its storage object. The pg_dump and storage export taken pre-deploy (per the PR 1 deploy checklist) are the only way to restore them. Apply via:
   - psql restore: re-INSERT the captured row
   - Storage upload: restore the object via storage SDK or `supabase storage cp` from the pre-deploy export

4. **Document_types rows.** Step 14 deletes the 6 seeded canonical types (matched by `created_by IS NULL` AND name-in-list). Old admin-created types with non-null `created_by` are preserved.
