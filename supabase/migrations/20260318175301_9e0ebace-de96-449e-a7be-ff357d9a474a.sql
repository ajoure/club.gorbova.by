
-- 1. Tags table (full entity standard)
CREATE TABLE public.site_page_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text UNIQUE NOT NULL DEFAULT '',
  workspace_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, name)
);

-- 2. public_id trigger
CREATE OR REPLACE FUNCTION public.set_site_page_tag_public_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    NEW.public_id := public.next_public_id('site_page_tag');
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_site_page_tags_public_id
  BEFORE INSERT ON public.site_page_tags
  FOR EACH ROW EXECUTE FUNCTION public.set_site_page_tag_public_id();

-- 3. updated_at trigger
CREATE OR REPLACE FUNCTION public.set_site_page_tag_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_site_page_tags_updated_at
  BEFORE UPDATE ON public.site_page_tags
  FOR EACH ROW EXECUTE FUNCTION public.set_site_page_tag_updated_at();

-- 4. Link table (EXCEPTION: junction only, no entity fields)
CREATE TABLE public.site_page_tag_links (
  page_id uuid NOT NULL REFERENCES public.site_pages(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.site_page_tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, tag_id)
);

-- 5. Index for reverse lookups
CREATE INDEX idx_site_page_tag_links_tag_id ON public.site_page_tag_links(tag_id);

-- 6. RLS
ALTER TABLE public.site_page_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_page_tag_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage workspace tags"
  ON public.site_page_tags FOR ALL TO authenticated
  USING (
    workspace_id = '00000000-0000-0000-0000-000000000000'::uuid
    AND (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
  )
  WITH CHECK (
    workspace_id = '00000000-0000-0000-0000-000000000000'::uuid
    AND (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
  );

CREATE POLICY "Admins manage tag links in workspace"
  ON public.site_page_tag_links FOR ALL TO authenticated
  USING (
    (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
    AND EXISTS (
      SELECT 1 FROM public.site_page_tags t
      WHERE t.id = tag_id
      AND t.workspace_id = '00000000-0000-0000-0000-000000000000'::uuid
    )
    AND EXISTS (
      SELECT 1 FROM public.site_pages p
      WHERE p.id = page_id
      AND p.workspace_id = '00000000-0000-0000-0000-000000000000'::uuid
    )
  )
  WITH CHECK (
    (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'))
    AND EXISTS (
      SELECT 1 FROM public.site_page_tags t
      WHERE t.id = tag_id
      AND t.workspace_id = '00000000-0000-0000-0000-000000000000'::uuid
    )
    AND EXISTS (
      SELECT 1 FROM public.site_pages p
      WHERE p.id = page_id
      AND p.workspace_id = '00000000-0000-0000-0000-000000000000'::uuid
    )
  );
