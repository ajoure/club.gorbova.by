
-- 1. Register entity type (idempotent)
INSERT INTO public.public_id_sequences (entity_type, prefix, last_value)
VALUES ('site_form_submission', 'SFS', 0)
ON CONFLICT (entity_type) DO NOTHING;

-- 2. Create table
CREATE TABLE IF NOT EXISTS public.site_form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text UNIQUE NOT NULL,
  workspace_id uuid NOT NULL,
  page_id uuid NOT NULL REFERENCES public.site_pages(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  form_data jsonb NOT NULL DEFAULT '{}',
  field_mapping jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'new',
  source text NOT NULL DEFAULT 'site_form',
  created_by uuid,
  updated_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. public_id trigger
CREATE OR REPLACE FUNCTION public.trg_site_form_submissions_public_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    NEW.public_id := public.next_public_id('site_form_submission');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_site_form_submissions_public_id ON public.site_form_submissions;
CREATE TRIGGER set_site_form_submissions_public_id
  BEFORE INSERT ON public.site_form_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_site_form_submissions_public_id();

-- 4. updated_at trigger
DROP TRIGGER IF EXISTS trg_site_form_submissions_updated_at ON public.site_form_submissions;
CREATE TRIGGER trg_site_form_submissions_updated_at
  BEFORE UPDATE ON public.site_form_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 5. RLS
ALTER TABLE public.site_form_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view submissions" ON public.site_form_submissions;
CREATE POLICY "Admins can view submissions"
  ON public.site_form_submissions
  FOR SELECT
  TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

DROP POLICY IF EXISTS "Admins can update submissions" ON public.site_form_submissions;
CREATE POLICY "Admins can update submissions"
  ON public.site_form_submissions
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_site_form_submissions_page_id ON public.site_form_submissions(page_id);
CREATE INDEX IF NOT EXISTS idx_site_form_submissions_profile_id ON public.site_form_submissions(profile_id);
CREATE INDEX IF NOT EXISTS idx_site_form_submissions_status ON public.site_form_submissions(status);
CREATE INDEX IF NOT EXISTS idx_site_form_submissions_workspace_id ON public.site_form_submissions(workspace_id);
