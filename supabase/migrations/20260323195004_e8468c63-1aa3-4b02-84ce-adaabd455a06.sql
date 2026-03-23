
-- PATCH 10: batch table + generation_batch_id

-- 1. Create ai_document_generation_batches
CREATE TABLE IF NOT EXISTS public.ai_document_generation_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  package_template_id uuid REFERENCES public.document_package_templates(id),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  meta jsonb NOT NULL DEFAULT '{}',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Add generation_batch_id to ai_generated_documents
ALTER TABLE public.ai_generated_documents
  ADD COLUMN IF NOT EXISTS generation_batch_id uuid REFERENCES public.ai_document_generation_batches(id);

-- 3. RLS for batches
ALTER TABLE public.ai_document_generation_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can select own batches"
  ON public.ai_document_generation_batches FOR SELECT TO authenticated
  USING (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Owner can insert own batches"
  ON public.ai_document_generation_batches FOR INSERT TO authenticated
  WITH CHECK (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Owner can update own batches"
  ON public.ai_document_generation_batches FOR UPDATE TO authenticated
  USING (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Owner can delete own batches"
  ON public.ai_document_generation_batches FOR DELETE TO authenticated
  USING (profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()));

CREATE POLICY "Admin can select all batches"
  ON public.ai_document_generation_batches FOR SELECT TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin'));

CREATE POLICY "Admin can update all batches"
  ON public.ai_document_generation_batches FOR UPDATE TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin'));

-- 4. updated_at trigger for batches
CREATE OR REPLACE FUNCTION public.update_ai_batches_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_ai_batches_updated_at ON public.ai_document_generation_batches;
CREATE TRIGGER tr_ai_batches_updated_at
  BEFORE UPDATE ON public.ai_document_generation_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_ai_batches_updated_at();
