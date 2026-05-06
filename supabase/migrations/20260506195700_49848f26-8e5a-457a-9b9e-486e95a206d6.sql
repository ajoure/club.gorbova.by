-- Sprint 4 schema additions

ALTER TABLE public.ai_generated_documents
  ADD COLUMN IF NOT EXISTS regenerated_from_document_id uuid NULL
  REFERENCES public.ai_generated_documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ai_generated_documents_regenerated_from_idx
  ON public.ai_generated_documents (regenerated_from_document_id);

-- Allow employees to read aliases (manage stays admin-only via existing policy)
DROP POLICY IF EXISTS document_token_aliases_employee_read ON public.document_token_aliases;
CREATE POLICY document_token_aliases_employee_read
  ON public.document_token_aliases
  FOR SELECT
  TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin') OR public.has_role_v2(auth.uid(), 'owner') OR public.has_role_v2(auth.uid(), 'employee'));