-- =============================================
-- SECURITY FIX: restrict document UPDATE (review/approval) to admins
-- only. The original policy in 20260406_document_storage.sql allowed
-- both coordinators and admins, but the product requirement is
-- "document review by admin only". The UI was already admin-gated,
-- but the RLS gap meant a coordinator could hit the REST API
-- directly and approve/reject any volunteer's documents.
--
-- Coordinators retain SELECT so they can see compliance state for
-- their department; only admins can mutate status.
-- =============================================

DROP POLICY IF EXISTS "Coordinators and admins update documents" ON public.volunteer_documents;

CREATE POLICY "Admins update documents"
  ON public.volunteer_documents
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
