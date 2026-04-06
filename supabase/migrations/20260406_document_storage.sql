-- =============================================
-- DOCUMENT STORAGE & CREDENTIAL MANAGEMENT
-- Migration: 2026-04-06
-- =============================================

-- ── DOCUMENT TYPES (admin-defined) ──
CREATE TABLE public.document_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  is_required boolean NOT NULL DEFAULT false,
  has_expiry  boolean NOT NULL DEFAULT false,
  expiry_days integer,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid NOT NULL REFERENCES public.profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.document_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage document types"
  ON public.document_types FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Authenticated users read active document types"
  ON public.document_types FOR SELECT
  TO authenticated
  USING (is_active = true);

-- ── VOLUNTEER DOCUMENTS (uploaded files) ──
CREATE TABLE public.volunteer_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  volunteer_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  document_type_id uuid NOT NULL REFERENCES public.document_types(id),
  file_name        text NOT NULL,
  file_type        text NOT NULL,
  file_size        integer,
  storage_path     text NOT NULL,
  status           text NOT NULL DEFAULT 'pending_review'
                     CHECK (status IN ('pending_review','approved','rejected','expired')),
  reviewed_by      uuid REFERENCES public.profiles(id),
  reviewed_at      timestamptz,
  review_note      text,
  expires_at       timestamptz,
  uploaded_at      timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.volunteer_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Volunteers read own documents"
  ON public.volunteer_documents FOR SELECT
  TO authenticated
  USING (volunteer_id = auth.uid());

CREATE POLICY "Volunteers upload own documents"
  ON public.volunteer_documents FOR INSERT
  TO authenticated
  WITH CHECK (volunteer_id = auth.uid());

CREATE POLICY "Volunteers delete own pending documents"
  ON public.volunteer_documents FOR DELETE
  TO authenticated
  USING (volunteer_id = auth.uid() AND status = 'pending_review');

CREATE POLICY "Coordinators and admins read all documents"
  ON public.volunteer_documents FOR SELECT
  TO authenticated
  USING (public.is_coordinator_or_admin());

CREATE POLICY "Coordinators and admins update documents"
  ON public.volunteer_documents FOR UPDATE
  TO authenticated
  USING (public.is_coordinator_or_admin())
  WITH CHECK (public.is_coordinator_or_admin());

-- ── INDEXES ──
CREATE INDEX idx_volunteer_documents_volunteer ON public.volunteer_documents(volunteer_id);
CREATE INDEX idx_volunteer_documents_type ON public.volunteer_documents(document_type_id);
CREATE INDEX idx_volunteer_documents_status ON public.volunteer_documents(status);
CREATE INDEX idx_volunteer_documents_expiry ON public.volunteer_documents(expires_at) WHERE expires_at IS NOT NULL;

-- ── STORAGE BUCKET ──
INSERT INTO storage.buckets (id, name, public)
VALUES ('volunteer-documents', 'volunteer-documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Volunteers upload own docs to storage"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'volunteer-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Volunteers read own docs from storage"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'volunteer-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Coordinators and admins read all docs from storage"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'volunteer-documents'
    AND public.is_coordinator_or_admin()
  );

CREATE POLICY "Volunteers delete own docs from storage"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'volunteer-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
