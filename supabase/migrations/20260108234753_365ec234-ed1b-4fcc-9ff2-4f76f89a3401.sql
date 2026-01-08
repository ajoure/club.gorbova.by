-- Remove legal_form column from executors (data is already in full_name)
ALTER TABLE public.executors DROP COLUMN IF EXISTS legal_form;

-- Create documents-templates bucket for storing DOCX templates
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents-templates', 'documents-templates', false)
ON CONFLICT (id) DO NOTHING;

-- RLS for documents-templates bucket - only admins can access
CREATE POLICY "Admins can manage document templates"
ON storage.objects FOR ALL
USING (bucket_id = 'documents-templates' AND public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (bucket_id = 'documents-templates' AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- Make sure documents bucket exists and has proper policies
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- Users can view their own documents
CREATE POLICY "Users can view own documents"
ON storage.objects FOR SELECT
USING (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Admins can manage all documents
CREATE POLICY "Admins can manage all documents"
ON storage.objects FOR ALL
USING (bucket_id = 'documents' AND public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (bucket_id = 'documents' AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- Add file_url column if not exists (for storing signed URLs)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'generated_documents' 
    AND column_name = 'file_url'
  ) THEN
    ALTER TABLE public.generated_documents ADD COLUMN file_url TEXT;
  END IF;
END $$;