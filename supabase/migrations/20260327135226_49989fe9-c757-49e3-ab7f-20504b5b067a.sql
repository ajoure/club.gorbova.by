
-- 1. Create ai_prompt_attachments table
CREATE TABLE public.ai_prompt_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id uuid NOT NULL REFERENCES public.ai_user_prompts(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_type text NOT NULL CHECK (file_type IN ('word', 'excel', 'text')),
  file_size bigint NOT NULL,
  extracted_text text,
  extracted_chars int DEFAULT 0,
  extraction_status text DEFAULT 'ready' CHECK (extraction_status IN ('ready', 'empty', 'failed', 'truncated')),
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 2. Enable RLS
ALTER TABLE public.ai_prompt_attachments ENABLE ROW LEVEL SECURITY;

-- 3. RLS policies — admin/super_admin only
CREATE POLICY "Admin can manage prompt attachments"
  ON public.ai_prompt_attachments FOR ALL TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin')
  );

-- 4. Create private storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'prompt-attachments',
  'prompt-attachments',
  false,
  52428800, -- 50MB
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain',
    'application/rtf',
    'text/rtf'
  ]
);

-- 5. Storage RLS policies for prompt-attachments bucket
CREATE POLICY "Admin can upload prompt attachments"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'prompt-attachments'
    AND (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
  );

CREATE POLICY "Admin can read prompt attachments"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'prompt-attachments'
    AND (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
  );

CREATE POLICY "Admin can delete prompt attachments"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'prompt-attachments'
    AND (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
  );
