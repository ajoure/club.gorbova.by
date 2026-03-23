
-- PATCH 8: Add template_scope to document_templates
ALTER TABLE public.document_templates ADD COLUMN IF NOT EXISTS template_scope text NOT NULL DEFAULT 'billing';

-- PATCH 8: Create ai_generated_documents table
CREATE TABLE public.ai_generated_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  template_id uuid NULL REFERENCES public.document_templates(id) ON DELETE SET NULL,
  template_name text NOT NULL,
  template_source_path text NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'generated',
  legal_details_id uuid NULL,
  person_id uuid NULL,
  signer_person_id uuid NULL,
  signer_link_id uuid NULL,
  file_path text NULL,
  file_name text NULL,
  file_mime text NULL DEFAULT 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  storage_bucket text NOT NULL DEFAULT 'documents',
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  missing_tokens jsonb NOT NULL DEFAULT '[]'::jsonb,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  generation_error text NULL,
  deleted_at timestamptz NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indices
CREATE INDEX idx_ai_generated_docs_profile_created ON public.ai_generated_documents (profile_id, created_at DESC);
CREATE INDEX idx_ai_generated_docs_template ON public.ai_generated_documents (template_id);

-- updated_at trigger
CREATE TRIGGER set_ai_generated_documents_updated_at
  BEFORE UPDATE ON public.ai_generated_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.ai_generated_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_gen_docs_owner_select" ON public.ai_generated_documents
  FOR SELECT TO authenticated
  USING (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "ai_gen_docs_owner_insert" ON public.ai_generated_documents
  FOR INSERT TO authenticated
  WITH CHECK (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "ai_gen_docs_owner_update" ON public.ai_generated_documents
  FOR UPDATE TO authenticated
  USING (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "ai_gen_docs_owner_delete" ON public.ai_generated_documents
  FOR DELETE TO authenticated
  USING (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "ai_gen_docs_admin_all" ON public.ai_generated_documents
  FOR ALL TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));
